/**
 * InboxThread builder — takes any newly-created IngestionEvent and ensures
 * it belongs to an InboxThread. Groups by:
 *   - Outlook email   → rawPayload.conversationId
 *   - WhatsApp 1:1    → rawPayload.chatId (senderJid-based chats) → channel=WHATSAPP
 *   - WhatsApp group  → rawPayload.chatId with "@g.us" → channel=WHATSAPP_GROUP
 *   - Any other       → fallback to externalMessageId (each event its own thread)
 *
 * Runs in line with the existing pipeline — commercialiser + sync routes call
 * `attachEventToThread(eventId)` after they create an IngestionEvent. Safe to
 * call multiple times (idempotent on InboxThreadMessage.ingestionEventId unique).
 */
import { prisma } from "@/lib/prisma";
import { TicketStatus } from "@/generated/prisma";

const CLOSED_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.CLOSED,
  TicketStatus.INVOICED,
  TicketStatus.LOCKED,
];

type IngestionEventLike = {
  id: string;
  sourceRecordType: string | null;
  eventKind: string | null;
  rawPayload: unknown;
  receivedAt: Date;
  source: { sourceType: string };
};

type ChannelKey = { channel: "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER"; conversationKey: string };

function deriveChannelKey(event: IngestionEventLike): ChannelKey | null {
  const raw = (event.rawPayload ?? {}) as Record<string, unknown>;
  const sourceType = event.source.sourceType;

  if (sourceType === "OUTLOOK") {
    const convId = (raw.conversationId as string | undefined) ?? (raw.internetMessageId as string | undefined);
    if (!convId) return null;
    return { channel: "EMAIL", conversationKey: convId };
  }

  if (sourceType === "WHATSAPP") {
    // whatsapp-web.js payloads carry `chatId`, `from`, or `id._serialized`
    const chatId = (raw.chatId as string | undefined)
      ?? (raw.from as string | undefined)
      ?? ((raw.id as Record<string, unknown> | undefined)?._serialized as string | undefined);
    if (!chatId) return null;
    const isGroup = chatId.endsWith("@g.us");
    return { channel: isGroup ? "WHATSAPP_GROUP" : "WHATSAPP", conversationKey: chatId };
  }

  return null;
}

function deriveMeta(event: IngestionEventLike) {
  const raw = (event.rawPayload ?? {}) as Record<string, unknown>;
  const sourceType = event.source.sourceType;

  let subject: string | null = null;
  let sender: string | null = null;
  let snippet: string | null = null;
  const participants = new Set<string>();

  if (sourceType === "OUTLOOK") {
    subject = (raw.subject as string | undefined) ?? null;
    const from = raw.from as { emailAddress?: { name?: string; address?: string } } | undefined;
    sender = from?.emailAddress?.address ?? from?.emailAddress?.name ?? null;
    if (sender) participants.add(sender);
    const toList = (raw.toRecipients as Array<{ emailAddress?: { address?: string } }> | undefined) ?? [];
    for (const t of toList) { if (t.emailAddress?.address) participants.add(t.emailAddress.address); }
    snippet = ((raw.bodyPreview as string | undefined)
      ?? ((raw.body as Record<string, unknown> | undefined)?.content as string | undefined)
      ?? "").toString().slice(0, 240);
  } else if (sourceType === "WHATSAPP") {
    sender = (raw.from as string | undefined) ?? (raw.author as string | undefined) ?? null;
    if (sender) participants.add(sender);
    const body = raw.body as string | undefined;
    snippet = body ? body.slice(0, 240) : null;
    subject = snippet ? snippet.slice(0, 80) : null;
  }

  const hasAttachments =
    (raw.hasAttachments === true) ||
    (raw.hasMedia === true) ||
    Array.isArray(raw.attachments) && (raw.attachments as unknown[]).length > 0;

  return { subject, sender, snippet, participants: [...participants], hasAttachments };
}

/** Classify a thread based on its latest event + subject/body text. Cheap heuristic. */
function classify(subject: string | null, snippet: string | null): string | null {
  const text = `${subject ?? ""} ${snippet ?? ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (/\b(invoice|bill|statement|remittance|credit note|pro ?forma)\b/.test(text)) return "BILL";
  if (/\b(ord(-|er)|po |purchase order|please supply|please order)\b/.test(text)) return "ORDER";
  if (/\b(quote|quotation|price|cost|estimate|rfq)\b/.test(text)) return "QUOTE_REQUEST";
  if (/\b(delivery|dispatch|shipment|dispatched|tracking)\b/.test(text)) return "DELIVERY";
  if (/\b(re: |reply|regarding|thanks|thank you)\b/.test(text)) return "REPLY";
  if (/\b(unsubscribe|newsletter|promotion|marketing)\b/.test(text)) return "NOISE";
  return "UNKNOWN";
}

/** WhatsApp JIDs look like `447712345678@c.us` or `...@s.whatsapp.net`. */
function phoneDigitsFromWhatsAppJid(jid: string): string | null {
  const local = jid.split("@")[0] ?? "";
  const digits = local.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

type ConfidenceResult =
  | { confidence: "HIGH"; ticketId: string }
  | { confidence: "MEDIUM"; ticketId: null }
  | { confidence: "LOW"; ticketId: null };

/**
 * Look up contacts by the thread's conversationKey, walk to customers via
 * SiteContactLink, and decide:
 *   - distinct customers == 1 AND they have exactly 1 open ticket → HIGH
 *   - distinct customers >= 2 (regardless of ticket count)        → MEDIUM
 *   - distinct customers == 1 but 0 or >=2 open tickets           → MEDIUM
 *   - no contact match                                            → LOW
 */
async function resolveAutoLink(
  channel: "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER",
  conversationKey: string,
  sender: string | null,
): Promise<ConfidenceResult> {
  // Group chats fan out to many contacts; never auto-link.
  if (channel === "WHATSAPP_GROUP") return { confidence: "LOW", ticketId: null };

  let contactIds: string[] = [];

  if (channel === "EMAIL") {
    const addr = (sender ?? "").trim().toLowerCase();
    if (!addr) return { confidence: "LOW", ticketId: null };
    const contacts = await prisma.contact.findMany({
      where: { email: { equals: addr, mode: "insensitive" }, isActive: true },
      select: { id: true },
    });
    contactIds = contacts.map((c) => c.id);
  } else if (channel === "WHATSAPP" || channel === "SMS") {
    const digits = phoneDigitsFromWhatsAppJid(conversationKey) ?? phoneDigits(sender);
    if (!digits) return { confidence: "LOW", ticketId: null };
    // Phones are stored free-text (+44, spaces, etc.). Pull candidates and
    // compare digits-only in-memory rather than relying on LIKE patterns.
    const candidates = await prisma.contact.findMany({
      where: { phone: { not: null }, isActive: true },
      select: { id: true, phone: true },
    });
    contactIds = candidates
      .filter((c) => {
        const d = phoneDigits(c.phone);
        if (!d) return false;
        // Match if either number ends with the other — handles stored numbers
        // with or without country code.
        return d === digits || d.endsWith(digits) || digits.endsWith(d);
      })
      .map((c) => c.id);
  } else {
    return { confidence: "LOW", ticketId: null };
  }

  if (contactIds.length === 0) return { confidence: "LOW", ticketId: null };

  const links = await prisma.siteContactLink.findMany({
    where: { contactId: { in: contactIds }, customerId: { not: null }, isActive: true },
    select: { customerId: true },
  });
  const customerIds = Array.from(new Set(links.map((l) => l.customerId!).filter(Boolean)));

  if (customerIds.length === 0) return { confidence: "LOW", ticketId: null };
  if (customerIds.length > 1) return { confidence: "MEDIUM", ticketId: null };

  const openTickets = await prisma.ticket.findMany({
    where: {
      payingCustomerId: customerIds[0],
      status: { notIn: CLOSED_TICKET_STATUSES },
    },
    select: { id: true },
    take: 2,
  });

  if (openTickets.length === 1) return { confidence: "HIGH", ticketId: openTickets[0].id };
  return { confidence: "MEDIUM", ticketId: null };
}

/**
 * Attach a single IngestionEvent to its InboxThread. Idempotent.
 * Returns the thread id, or null if the event isn't thread-able.
 */
export async function attachEventToThread(eventId: string): Promise<string | null> {
  const event = await prisma.ingestionEvent.findUnique({
    where: { id: eventId },
    include: { source: { select: { sourceType: true } } },
  });
  if (!event) return null;

  const key = deriveChannelKey(event);
  if (!key) return null;

  // If this event is already on a thread, nothing to do.
  const existingMsg = await prisma.inboxThreadMessage.findUnique({ where: { ingestionEventId: eventId } });
  if (existingMsg) return existingMsg.threadId;

  const meta = deriveMeta(event);
  const cls = classify(meta.subject, meta.snippet);

  // Upsert thread
  const thread = await prisma.inboxThread.upsert({
    where: { channel_conversationKey: { channel: key.channel, conversationKey: key.conversationKey } },
    create: {
      channel: key.channel,
      conversationKey: key.conversationKey,
      subject: meta.subject,
      participants: meta.participants,
      classification: cls,
      firstAt: event.receivedAt,
      latestAt: event.receivedAt,
      messageCount: 0, // bumped below
      lastSnippet: meta.snippet,
      status: "NEW",
    },
    update: {},
  });

  // Add this message + bump aggregates
  await prisma.$transaction([
    prisma.inboxThreadMessage.create({
      data: {
        threadId: thread.id,
        ingestionEventId: eventId,
        occurredAt: event.receivedAt,
        sender: meta.sender,
        snippet: meta.snippet,
        hasAttachments: meta.hasAttachments,
      },
    }),
    prisma.inboxThread.update({
      where: { id: thread.id },
      data: {
        messageCount: { increment: 1 },
        // Keep the latest timestamp + snippet
        latestAt: event.receivedAt > thread.latestAt ? event.receivedAt : thread.latestAt,
        lastSnippet: event.receivedAt > thread.latestAt ? meta.snippet : thread.lastSnippet,
        // Merge participant list (deduped)
        participants: { set: Array.from(new Set([...thread.participants, ...meta.participants])) },
        // Subject: keep the first non-empty one; only overwrite if current is empty
        subject: thread.subject ?? meta.subject,
        // Classification: only overwrite if current is null or UNKNOWN
        classification: thread.classification && thread.classification !== "UNKNOWN"
          ? thread.classification
          : (cls ?? thread.classification),
      },
    }),
  ]);

  await autoLinkThread(thread.id, key.channel, key.conversationKey, meta.sender);

  return thread.id;
}

/**
 * Contact-based auto-link. Runs after the thread upsert so every newly-arrived
 * message gets another chance to match (e.g. a contact added after first touch).
 * Protects any MANUAL link — once a human has linked a thread, we never touch
 * it again, even if the auto-linker disagrees.
 */
async function autoLinkThread(
  threadId: string,
  channel: "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER",
  conversationKey: string,
  sender: string | null,
): Promise<void> {
  const current = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    select: { linkedTicketId: true, linkSource: true, linkConfidence: true },
  });
  if (!current) return;
  if (current.linkSource === "MANUAL") return;

  const result = await resolveAutoLink(channel, conversationKey, sender);

  if (result.confidence === "LOW") {
    // Only write LOW if we haven't already recorded a better auto-confidence.
    // Prevents a later LOW read from clobbering an earlier HIGH/MEDIUM verdict.
    if (current.linkConfidence == null) {
      await prisma.inboxThread.update({
        where: { id: threadId },
        data: { linkConfidence: "LOW", linkSource: "AUTO" },
      });
    }
    return;
  }

  if (result.confidence === "HIGH") {
    await prisma.inboxThread.update({
      where: { id: threadId },
      data: {
        linkedTicketId: result.ticketId,
        linkConfidence: "HIGH",
        linkSource: "AUTO",
        status: "LINKED",
      },
    });
    return;
  }

  // MEDIUM: don't link, but surface so the UI can offer one-tap selection.
  await prisma.inboxThread.update({
    where: { id: threadId },
    data: { linkConfidence: "MEDIUM", linkSource: "AUTO" },
  });
}

/** Bulk backfill — call once to populate InboxThread from existing IngestionEvents. */
export async function backfillAllEvents(opts: { sinceISO?: string } = {}) {
  const since = opts.sinceISO ? new Date(opts.sinceISO) : new Date("2026-04-01");
  const events = await prisma.ingestionEvent.findMany({
    where: { receivedAt: { gte: since } },
    select: { id: true },
    orderBy: { receivedAt: "asc" },
  });
  let attached = 0, skipped = 0;
  for (const e of events) {
    const threadId = await attachEventToThread(e.id);
    if (threadId) attached++; else skipped++;
  }
  return { events: events.length, attached, skipped };
}

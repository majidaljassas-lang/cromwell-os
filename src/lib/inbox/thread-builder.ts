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
import { scoreOpenTicketsForText, type LinkCandidate } from "@/lib/ingestion/link-resolver";

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
    // The live ingest route normalises whatsapp-web.js fields into snake_case
    // (`chat_id`, `sender_phone`). Accept either shape so pre-normalised and
    // raw-library payloads both thread correctly.
    const chatId = (raw.chat_id as string | undefined)
      ?? (raw.chatId as string | undefined)
      ?? (raw.from as string | undefined)
      ?? (raw.sender_phone as string | undefined)
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
    // Accept snake_case (live-ingest shape) or camelCase (raw lib shape).
    sender = (raw.sender_phone as string | undefined)
      ?? (raw.from as string | undefined)
      ?? (raw.author as string | undefined)
      ?? null;
    if (sender) participants.add(sender);
    const body = (raw.message_text as string | undefined) ?? (raw.body as string | undefined);
    snippet = body ? body.slice(0, 240) : null;
    subject = (raw.chat_name as string | undefined) ?? (snippet ? snippet.slice(0, 80) : null);
  }

  const hasAttachments =
    (raw.hasAttachments === true) ||
    (raw.hasMedia === true) ||
    (raw.has_media === true) ||
    (Array.isArray(raw.attachments) && (raw.attachments as unknown[]).length > 0);

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

// Contact-match confidence mapped onto the same 0-100 scale the content
// scorer uses, so we can compare apples to apples.
const CONTACT_SCORE = { HIGH: 80, MEDIUM: 45, LOW: 0 } as const;

// Tier cut-offs: these match link-resolver.ts so the two paths agree.
const SCORE_HIGH = 70;
const SCORE_MEDIUM = 40;

/**
 * Aggregate thread text (subject + recent message snippets) for content
 * scoring. Using up to 20 of the most recent messages keeps the signal fresh
 * without blowing up query size on long threads.
 */
async function buildScoringInputForThread(
  threadId: string,
  sender: string | null,
): Promise<{
  rawText: string;
  subject: string | null;
  receivedAt: Date;
  senderPhone: string | null;
  senderEmail: string | null;
}> {
  const thread = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    select: { subject: true, lastSnippet: true, latestAt: true },
  });
  const messages = await prisma.inboxThreadMessage.findMany({
    where: { threadId },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: { snippet: true, sender: true },
  });
  const rawText = [thread?.lastSnippet ?? "", ...messages.map((m) => m.snippet ?? "")]
    .filter(Boolean)
    .join("\n");

  // Sender may be an email, a phone JID, or a display name. Feed both slots
  // to the scorer — it discriminates internally.
  const senderEmail = sender && sender.includes("@") && !sender.includes("@c.us") && !sender.includes("@g.us")
    ? sender
    : null;
  const senderPhone = sender && (sender.includes("@c.us") || sender.includes("@s.whatsapp.net"))
    ? sender
    : null;

  return {
    rawText,
    subject: thread?.subject ?? null,
    receivedAt: thread?.latestAt ?? new Date(),
    senderPhone,
    senderEmail,
  };
}

/**
 * Auto-link a thread to an existing ticket using BOTH signals:
 *   1. Contact-based match (resolveAutoLink) — sender identity → customer → open tickets
 *   2. Content-based match (scoreOpenTicketsForText) — refs, site, customer name,
 *      products, timeline mentioned in the message bodies
 * Picks the higher-scoring candidate and applies HIGH/MEDIUM/LOW gates.
 *
 * Never creates a ticket — only links to existing ones.
 * Protects MANUAL links: once a human has linked a thread, we never touch it.
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

  // 1) Contact-based candidate
  const contact = await resolveAutoLink(channel, conversationKey, sender);
  const contactCandidate = contact.ticketId
    ? { ticketId: contact.ticketId, score: CONTACT_SCORE[contact.confidence], reasons: ["Contact-based match"] }
    : { ticketId: null, score: CONTACT_SCORE[contact.confidence], reasons: [] as string[] };

  // 2) Content-based candidate — score against all open tickets using message text
  const scoringInput = await buildScoringInputForThread(threadId, sender);
  const contentCandidates: LinkCandidate[] = scoringInput.rawText.trim().length > 0
    ? await scoreOpenTicketsForText({
        eventType: "THREAD_SCORING",
        sourceType: channel === "EMAIL" ? "OUTLOOK" : "WHATSAPP",
        sender,
        senderPhone: scoringInput.senderPhone,
        senderEmail: scoringInput.senderEmail,
        receivedAt: scoringInput.receivedAt,
        rawText: scoringInput.rawText,
        subject: scoringInput.subject,
      })
    : [];
  const topContent = contentCandidates[0];

  // 3) Pick the winner. If both point at the same ticket, boost the score
  //    (signals corroborate). Otherwise take the higher individual score.
  let winnerTicketId: string | null = null;
  let winnerScore = 0;
  let winnerReasons: string[] = [];

  if (topContent && contactCandidate.ticketId && topContent.entityId === contactCandidate.ticketId) {
    winnerTicketId = topContent.entityId;
    winnerScore = Math.min(100, topContent.score + contactCandidate.score);
    winnerReasons = [...topContent.reasons, ...contactCandidate.reasons];
  } else if (topContent && topContent.score >= contactCandidate.score) {
    winnerTicketId = topContent.entityId;
    winnerScore = topContent.score;
    winnerReasons = topContent.reasons;
  } else if (contactCandidate.ticketId) {
    winnerTicketId = contactCandidate.ticketId;
    winnerScore = contactCandidate.score;
    winnerReasons = contactCandidate.reasons;
  }

  // 4) Apply tier gates
  if (winnerTicketId && winnerScore >= SCORE_HIGH) {
    await prisma.inboxThread.update({
      where: { id: threadId },
      data: {
        linkedTicketId: winnerTicketId,
        linkConfidence: "HIGH",
        linkSource: "AUTO",
        status: "LINKED",
      },
    });
    return;
  }

  if (winnerTicketId && winnerScore >= SCORE_MEDIUM) {
    // Suggestion: stash the ticket id so the UI can offer one-tap confirm,
    // but keep status=NEW (not LINKED) until the human accepts.
    await prisma.inboxThread.update({
      where: { id: threadId },
      data: {
        linkedTicketId: winnerTicketId,
        linkConfidence: "MEDIUM",
        linkSource: "AUTO",
      },
    });
    return;
  }

  // LOW / NONE — flag as potential new, don't clobber a prior better verdict.
  if (current.linkConfidence == null) {
    await prisma.inboxThread.update({
      where: { id: threadId },
      data: { linkConfidence: "LOW", linkSource: "AUTO" },
    });
  }
  // Record the top reasons on console for debugging during backfill runs.
  if (winnerReasons.length > 0) {
    console.log(`[autoLinkThread] thread=${threadId} score=${winnerScore} LOW — reasons: ${winnerReasons.join("; ")}`);
  }
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

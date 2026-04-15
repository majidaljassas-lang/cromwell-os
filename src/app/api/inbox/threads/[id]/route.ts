/**
 * GET    /api/inbox/threads/:id           — full thread with all messages
 * PATCH  /api/inbox/threads/:id           — { action: "ACCEPT" | "NOISE" | "LINK" | "UNDO"; ticketId?: string }
 *
 * ACCEPT  → create a new Ticket from the thread (or link to ticketId if provided), status=LINKED
 * NOISE   → status=NOISE, hidden from default inbox view
 * LINK    → status=LINKED, linkedTicketId=ticketId (caller supplies existing ticket)
 * UNDO    → status=NEW, clear linkedTicketId
 */
import { prisma } from "@/lib/prisma";

type CustomerResolution =
  | { ok: true; customerId: string }
  | { ok: false; error: string };

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

/**
 * Resolve a single payingCustomerId from a thread's sender. Mirror of the
 * contact-walk in thread-builder.ts so ACCEPT and the auto-linker stay
 * consistent: same Contact lookup, same SiteContactLink walk.
 */
async function deriveCustomerFromThread(thread: {
  channel: string;
  conversationKey: string;
  participants: string[];
}): Promise<CustomerResolution> {
  let contactIds: string[] = [];

  if (thread.channel === "EMAIL") {
    const emails = (thread.participants || [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.includes("@"));
    if (emails.length === 0) return { ok: false, error: "no email participants on thread" };
    const contacts = await prisma.contact.findMany({
      where: { email: { in: emails, mode: "insensitive" }, isActive: true },
      select: { id: true },
    });
    contactIds = contacts.map((c) => c.id);
  } else if (thread.channel === "WHATSAPP" || thread.channel === "SMS") {
    const localPart = thread.conversationKey.split("@")[0] ?? "";
    const digits = phoneDigits(localPart);
    if (!digits) return { ok: false, error: "could not parse phone from conversationKey" };
    const candidates = await prisma.contact.findMany({
      where: { phone: { not: null }, isActive: true },
      select: { id: true, phone: true },
    });
    contactIds = candidates
      .filter((c) => {
        const d = phoneDigits(c.phone);
        if (!d) return false;
        return d === digits || d.endsWith(digits) || digits.endsWith(d);
      })
      .map((c) => c.id);
  } else {
    return { ok: false, error: `cannot auto-derive customer for channel ${thread.channel} — use LINK instead` };
  }

  if (contactIds.length === 0) {
    return { ok: false, error: "sender not in Contacts — add the contact first, or use LINK to attach to an existing ticket" };
  }

  const links = await prisma.siteContactLink.findMany({
    where: { contactId: { in: contactIds }, customerId: { not: null }, isActive: true },
    select: { customerId: true },
  });
  const customerIds = Array.from(new Set(links.map((l) => l.customerId!).filter(Boolean)));

  if (customerIds.length === 0) {
    return { ok: false, error: "sender's Contact has no Customer link — link them in Contacts, or use LINK" };
  }
  if (customerIds.length > 1) {
    return { ok: false, error: `sender resolves to ${customerIds.length} customers — use LINK to specify which ticket` };
  }
  return { ok: true, customerId: customerIds[0] };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { occurredAt: "asc" },
      },
      linkedTicket: { select: { id: true, ticketNo: true, title: true, status: true } },
    },
  });
  if (!thread) return Response.json({ error: "thread not found" }, { status: 404 });
  return Response.json({ thread });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const { id } = await params;
  const body = await request.json() as { action?: string; ticketId?: string; title?: string };
  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: { messages: { take: 1, orderBy: { occurredAt: "asc" } } },
  });
  if (!thread) return Response.json({ error: "thread not found" }, { status: 404 });

  if (body.action === "NOISE") {
    await prisma.inboxThread.update({
      where: { id },
      data: { status: "NOISE", noisedAt: new Date(), triagedAt: new Date() },
    });
    return Response.json({ ok: true, status: "NOISE" });
  }

  if (body.action === "UNDO") {
    await prisma.inboxThread.update({
      where: { id },
      data: { status: "NEW", noisedAt: null, triagedAt: null, linkedTicketId: null },
    });
    return Response.json({ ok: true, status: "NEW" });
  }

  if (body.action === "LINK") {
    if (!body.ticketId) return Response.json({ error: "ticketId required" }, { status: 400 });
    await prisma.inboxThread.update({
      where: { id },
      data: { status: "LINKED", linkedTicketId: body.ticketId, triagedAt: new Date() },
    });
    return Response.json({ ok: true, status: "LINKED", ticketId: body.ticketId });
  }

  if (body.action === "ACCEPT") {
    // Auto-derive payingCustomerId from the thread's sender via
    // Contact → SiteContactLink → Customer. ACCEPT only succeeds when the
    // sender resolves to exactly one customer; ambiguous / unknown senders
    // get a clear error so the user can fall back to LINK.
    const customerResolution = await deriveCustomerFromThread(thread);
    if (!customerResolution.ok) {
      return Response.json({ error: customerResolution.error }, { status: 400 });
    }

    const ticketMode =
      thread.classification === "ORDER" ? "DIRECT_ORDER" :
      thread.classification === "QUOTE_REQUEST" ? "PRICING_FIRST" :
      "DIRECT_ORDER";

    const title = body.title ?? thread.subject ?? `Thread ${thread.id.slice(0, 8)}`;
    const ticket = await prisma.ticket.create({
      data: {
        title: title.slice(0, 200),
        ticketMode,
        status: "CAPTURED",
        payingCustomer: { connect: { id: customerResolution.customerId } },
      },
    });
    await prisma.inboxThread.update({
      where: { id },
      data: {
        status: "LINKED",
        linkedTicketId: ticket.id,
        triagedAt: new Date(),
      },
    });
    return Response.json({ ok: true, status: "LINKED", ticket: { id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title } });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/inbox/threads/[id] failed:", err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/inbox/threads/:id
 *
 * Permanently removes the thread + its messages + the underlying IngestionEvents
 * (plus any ParsedMessage / IntakeDocument / ExtractedEntity / IngestionLink
 * derived from those events) from Cromwell OS.
 *
 * Safety rails:
 *   - Only threads with status = NOISE can be hard-deleted (or pass ?force=1 to override)
 *   - NEVER deletes IngestionEvents that have a SupplierBill derived from them
 *     (those are accounting records we must keep)
 *   - Email itself remains in Outlook — we only wipe OS-side state
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: { messages: { select: { ingestionEventId: true } } },
  });
  if (!thread) return Response.json({ error: "thread not found" }, { status: 404 });
  if (thread.status !== "NOISE" && !force) {
    return Response.json({ error: `refusing — thread is ${thread.status}; must be NOISE or pass ?force=1` }, { status: 409 });
  }

  const eventIds = thread.messages.map((m) => m.ingestionEventId);

  // Detect events that have accounting records derived from them — keep those.
  const protectedEventIds = new Set<string>();
  if (eventIds.length) {
    const bills = await prisma.supplierBill.findMany({
      where: { sourceAttachmentRef: { in: eventIds } },
      select: { sourceAttachmentRef: true },
    });
    for (const b of bills) if (b.sourceAttachmentRef) protectedEventIds.add(b.sourceAttachmentRef);

    const intakeDocs = await prisma.intakeDocument.findMany({
      where: { ingestionEventId: { in: eventIds }, supplierBillId: { not: null } },
      select: { ingestionEventId: true },
    });
    for (const d of intakeDocs) if (d.ingestionEventId) protectedEventIds.add(d.ingestionEventId);
  }
  const deletableEventIds = eventIds.filter((id) => !protectedEventIds.has(id));

  // Cascade delete in the right order. Wrap in a transaction.
  const deleted = await prisma.$transaction(async (tx) => {
    // 1. Delete IntakeDocument rows for these events (not yet promoted to bills)
    const intake = await tx.intakeDocument.deleteMany({
      where: { ingestionEventId: { in: deletableEventIds }, supplierBillId: null },
    });

    // 2. Delete ExtractedEntity + IngestionLink via ParsedMessage (need the parsedMessage ids first)
    const parsed = await tx.parsedMessage.findMany({
      where: { ingestionEventId: { in: deletableEventIds } },
      select: { id: true },
    });
    const parsedIds = parsed.map((p) => p.id);
    const entities = await tx.extractedEntity.deleteMany({ where: { parsedMessageId: { in: parsedIds } } });
    const links    = await tx.ingestionLink.deleteMany({ where: { parsedMessageId: { in: parsedIds } } });

    // 3. Delete ParsedMessage rows
    const parsedDel = await tx.parsedMessage.deleteMany({ where: { id: { in: parsedIds } } });

    // 4. Delete SourceSiteMatch rows
    const sourceSite = await tx.sourceSiteMatch.deleteMany({ where: { ingestionEventId: { in: deletableEventIds } } });

    // 5. Delete DraftInvoiceRecoveryItem rows (if any)
    let draftRecovery = { count: 0 };
    try {
      draftRecovery = await tx.draftInvoiceRecoveryItem.deleteMany({ where: { ingestionEventId: { in: deletableEventIds } } });
    } catch { /* optional */ }

    // 6. Delete the InboxThreadMessage rows (cascade will also run, but explicit is safer)
    const threadMsgs = await tx.inboxThreadMessage.deleteMany({ where: { threadId: id } });

    // 7. Delete IngestionEvent rows (only the ones not protected)
    const events = await tx.ingestionEvent.deleteMany({ where: { id: { in: deletableEventIds } } });

    // 8. Finally drop the thread itself
    await tx.inboxThread.delete({ where: { id } });

    return { intake, entities, links, parsed: parsedDel, sourceSite, draftRecovery, threadMsgs, events };
  });

  return Response.json({
    ok: true,
    threadId: id,
    eventsDeleted: deleted.events.count,
    eventsProtected: protectedEventIds.size,
    details: deleted,
  });
}

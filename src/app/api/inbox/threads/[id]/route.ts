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
    // Create a new Ticket from this thread
    const lastTicket = await prisma.ticket.findFirst({ orderBy: { ticketNo: "desc" }, select: { ticketNo: true } });
    const nextTicketNo = (lastTicket?.ticketNo ?? 0) + 1;
    const title = body.title ?? thread.subject ?? `Thread ${thread.id.slice(0, 8)}`;
    const ticket = await prisma.ticket.create({
      data: {
        ticketNo: nextTicketNo,
        title: title.slice(0, 200),
        ticketMode: thread.classification === "ORDER" ? "DIRECT_ORDER" : "ENQUIRY",
        status: "CAPTURED",
        revenueState: "UNCAPTURED",
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

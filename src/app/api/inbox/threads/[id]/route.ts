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

/**
 * GET /api/inbox/messages?status=NEW&q=...&channel=EMAIL&limit=200
 *   Flat list of inbox messages (one row per email/WA message).
 *   Replaces the threaded view for manual classification.
 *
 *   status:
 *     NEW       — message's thread has no linkedTicketId, no manual actions yet
 *     CLASSIFIED — message has at least one ManualInboxAction
 *     LINKED    — message's thread is linked to a ticket
 *     ALL       — everything since cutover
 */
import { prisma } from "@/lib/prisma";

const CUTOVER = new Date("2026-04-01");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "NEW").toUpperCase();
  const channel = url.searchParams.get("channel")?.toUpperCase();
  const q       = url.searchParams.get("q")?.trim();
  const limit   = Math.min(1000, Number(url.searchParams.get("limit") ?? "200"));

  const where: Record<string, unknown> = {
    occurredAt: { gte: CUTOVER },
  };
  if (channel && channel !== "ALL") where.thread = { channel };
  if (q) {
    where.OR = [
      { sender: { contains: q, mode: "insensitive" } },
      { snippet: { contains: q, mode: "insensitive" } },
      { thread: { subject: { contains: q, mode: "insensitive" } } },
    ];
  }

  if (status === "NEW") {
    where.thread = { ...(where.thread as object ?? {}), linkedTicketId: null };
  } else if (status === "LINKED") {
    where.thread = { ...(where.thread as object ?? {}), NOT: { linkedTicketId: null } };
  }

  const messages = await prisma.inboxThreadMessage.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: limit,
    include: {
      thread: {
        select: {
          id: true,
          channel: true,
          subject: true,
          conversationKey: true,
          linkedTicketId: true,
          linkedTicket: {
            select: {
              id: true,
              ticketNo: true,
              title: true,
              status: true,
              payingCustomer: { select: { id: true, name: true } },
              site: { select: { id: true, siteName: true } },
            },
          },
        },
      },
    },
  });

  const eventIds = messages.map((m) => m.ingestionEventId);
  const actions = eventIds.length
    ? await prisma.manualInboxAction.findMany({
        where: { ingestionEventId: { in: eventIds } },
        include: { tag: { select: { id: true, name: true, label: true, category: true } } },
      })
    : [];
  const actionsByEvent = new Map<string, typeof actions>();
  for (const a of actions) {
    const list = actionsByEvent.get(a.ingestionEventId) ?? [];
    list.push(a);
    actionsByEvent.set(a.ingestionEventId, list);
  }

  // Status counts for tabs.
  const [newCount, linkedCount, classifiedCount, allCount] = await Promise.all([
    prisma.inboxThreadMessage.count({
      where: { occurredAt: { gte: CUTOVER }, thread: { linkedTicketId: null } },
    }),
    prisma.inboxThreadMessage.count({
      where: { occurredAt: { gte: CUTOVER }, thread: { NOT: { linkedTicketId: null } } },
    }),
    prisma.manualInboxAction.findMany({
      where: { createdAt: { gte: CUTOVER } },
      select: { ingestionEventId: true },
      distinct: ["ingestionEventId"],
    }).then((r) => r.length),
    prisma.inboxThreadMessage.count({ where: { occurredAt: { gte: CUTOVER } } }),
  ]);

  return Response.json({
    asOf: new Date().toISOString(),
    counts: { NEW: newCount, LINKED: linkedCount, CLASSIFIED: classifiedCount, ALL: allCount },
    messages: messages.map((m) => ({
      id: m.id,
      ingestionEventId: m.ingestionEventId,
      threadId: m.threadId,
      channel: m.thread.channel,
      subject: m.thread.subject,
      conversationKey: m.thread.conversationKey,
      sender: m.sender,
      snippet: m.snippet,
      hasAttachments: m.hasAttachments,
      occurredAt: m.occurredAt,
      classifications: (actionsByEvent.get(m.ingestionEventId) ?? []).map((a) => ({
        actionId: a.id,
        tagId: a.tagId,
        tagName: a.tag.name,
        tagLabel: a.tag.label,
        category: a.tag.category,
        ticketId: a.ticketId,
        createdAt: a.createdAt,
      })),
      linkedTicket: m.thread.linkedTicket
        ? {
            id: m.thread.linkedTicket.id,
            ticketNo: m.thread.linkedTicket.ticketNo,
            title: m.thread.linkedTicket.title,
            status: m.thread.linkedTicket.status,
            customer: m.thread.linkedTicket.payingCustomer,
            site: m.thread.linkedTicket.site,
          }
        : null,
    })),
  });
}

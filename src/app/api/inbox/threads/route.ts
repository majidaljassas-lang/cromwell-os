/**
 * GET /api/inbox/threads?status=NEW&q=...&channel=EMAIL&limit=100
 *   List inbox threads, filterable by status/channel/search.
 */
import { prisma } from "@/lib/prisma";

const CUTOVER = new Date("2026-04-01");

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "NEW").toUpperCase();
  const channel = url.searchParams.get("channel")?.toUpperCase();
  const q       = url.searchParams.get("q")?.trim();
  const limit   = Math.min(500, Number(url.searchParams.get("limit") ?? "100"));

  const where: Record<string, unknown> = { latestAt: { gte: CUTOVER } };
  if (status !== "ALL") where.status = status;
  if (channel && channel !== "ALL") where.channel = channel;
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      { lastSnippet: { contains: q, mode: "insensitive" } },
      { participants: { has: q.toLowerCase() } },
    ];
  }

  const [threads, counts] = await Promise.all([
    prisma.inboxThread.findMany({
      where,
      orderBy: { latestAt: "desc" },
      take: limit,
      include: {
        _count: { select: { messages: true } },
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
    }),
    // Status counts for tabs
    prisma.inboxThread.groupBy({
      by: ["status"],
      where: { latestAt: { gte: CUTOVER } },
      _count: { _all: true },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const c of counts) statusCounts[c.status] = c._count._all;

  return Response.json({
    asOf: new Date().toISOString(),
    counts: statusCounts,
    threads: threads.map((t) => ({
      id: t.id,
      channel: t.channel,
      subject: t.subject,
      participants: t.participants,
      classification: t.classification,
      latestAt: t.latestAt,
      firstAt: t.firstAt,
      messageCount: t._count.messages,
      lastSnippet: t.lastSnippet,
      status: t.status,
      linkConfidence: t.linkConfidence,
      linkSource: t.linkSource,
      linkedTicket: t.linkedTicket
        ? {
            id: t.linkedTicket.id,
            ticketNo: t.linkedTicket.ticketNo,
            title: t.linkedTicket.title,
            status: t.linkedTicket.status,
            customer: t.linkedTicket.payingCustomer,
            site: t.linkedTicket.site,
          }
        : null,
    })),
  });
}

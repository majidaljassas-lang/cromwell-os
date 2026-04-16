import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const [
    inboxNew,
    inboxEmail,
    inboxWa,
    ticketsByStatus,
    ticketsByMode,
    recentTickets,
    tasksByType,
    receivables,
    payables,
    disputed,
    stockItems,
    lastSync,
    eventsToday,
  ] = await Promise.all([
    prisma.inboxThread.count({ where: { status: "NEW" } }),
    prisma.inboxThread.count({ where: { status: "NEW", channel: "EMAIL" } }),
    prisma.inboxThread.count({ where: { status: "NEW", channel: { in: ["WHATSAPP", "WHATSAPP_GROUP"] } } }),
    prisma.ticket.groupBy({ by: ["status"], _count: true, where: { status: { notIn: ["CLOSED"] } } }),
    prisma.ticket.groupBy({ by: ["ticketMode"], _count: true, where: { status: { notIn: ["CLOSED"] } } }),
    prisma.ticket.findMany({
      where: { status: { notIn: ["CLOSED"] } },
      select: {
        id: true, ticketNo: true, title: true, status: true, ticketMode: true, createdAt: true,
        payingCustomer: { select: { name: true } },
        site: { select: { siteName: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.task.groupBy({ by: ["taskType"], _count: true, where: { status: "OPEN" } }),
    prisma.salesInvoice.aggregate({ _sum: { totalSell: true }, _count: true, where: { status: { in: ["SENT", "UNPAID"] } } }),
    prisma.supplierBill.aggregate({ _sum: { totalCost: true }, _count: true, where: { paymentStatus: "UNPAID" } }),
    prisma.supplierBill.aggregate({ _sum: { totalCost: true }, _count: true, where: { matchStatus: "DISPUTE" } }),
    prisma.stockItem.aggregate({ _count: true, _sum: { qtyOnHand: true }, where: { isActive: true, outcome: "HOLDING" } }),
    prisma.ingestionSource.findFirst({ where: { sourceType: "OUTLOOK", isActive: true }, select: { lastSyncAt: true } }),
    prisma.ingestionEvent.count({ where: { receivedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
  ]);

  const statusMap: Record<string, number> = {};
  for (const s of ticketsByStatus) statusMap[s.status] = s._count;

  const modeMap: Record<string, number> = {};
  for (const m of ticketsByMode) modeMap[m.ticketMode] = m._count;

  const taskMap: Record<string, number> = {};
  let taskTotal = 0;
  for (const t of tasksByType) { taskMap[t.taskType] = t._count; taskTotal += t._count; }

  return Response.json({
    inbox: {
      newCount: inboxNew,
      emailCount: inboxEmail,
      whatsappCount: inboxWa,
    },
    tickets: {
      total: Object.values(statusMap).reduce((a, b) => a + b, 0),
      byStatus: statusMap,
      byMode: modeMap,
      recent: recentTickets.map((t) => ({
        id: t.id,
        ticketNo: t.ticketNo,
        title: t.title,
        status: t.status,
        mode: t.ticketMode,
        customer: t.payingCustomer?.name ?? "",
        site: t.site?.siteName ?? "",
        lines: t._count.lines,
        createdAt: t.createdAt,
      })),
    },
    financial: {
      receivables: Number(receivables._sum.totalSell ?? 0),
      receivablesCount: receivables._count,
      payables: Number(payables._sum.totalCost ?? 0),
      payablesCount: payables._count,
      disputed: Number(disputed._sum.totalCost ?? 0),
      disputedCount: disputed._count,
    },
    tasks: { total: taskTotal, byType: taskMap },
    stock: {
      itemCount: stockItems._count,
      totalValue: Number(stockItems._sum.qtyOnHand ?? 0),
    },
    system: {
      lastSync: lastSync?.lastSyncAt?.toISOString() ?? null,
      eventsToday,
    },
  });
}

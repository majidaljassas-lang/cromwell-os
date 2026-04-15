import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/command-centre
 *
 * Single endpoint that returns everything the command-centre screen needs:
 *   • cashPosition — receivables / payables / disputed / available
 *   • criticalTasks — priority CRITICAL
 *   • todayTasks — dueAt between [startOfToday, endOfToday)
 *   • inTransit — POs with NOT_ARRIVED / BYPASSED LogisticsEvent
 *   • uninvoicedDeliveries — delivered, no SalesInvoiceLine
 *   • disputedBills — SupplierBill.matchStatus = DISPUTE
 *   • surplusStock — StockExcessRecord unresolved
 *   • systemHealth — latest scheduler runs + open-task counts by type
 *
 * All read-only. No mutations. Safe to poll.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const [
      unpaidInvoices,
      openBills,
      disputedBillsSum,
      criticalTasks,
      todayTasks,
      inTransit,
      uninvoicedDeliveries,
      disputedBills,
      surplusStock,
      schedulerLogs,
      openTasksByType,
    ] = await Promise.all([
      // Receivables — unpaid SalesInvoices
      prisma.salesInvoice.aggregate({
        where: {
          paidAt: null,
          payments: { none: {} },
          status: { notIn: ["DRAFT", "CANCELLED", "VOID", "PAID"] },
        },
        _sum: { totalSell: true },
        _count: { _all: true },
      }),
      // Payables — SupplierBills not paid, not DISPUTE
      prisma.supplierBill.aggregate({
        where: {
          paymentStatus: { notIn: ["PAID"] },
          matchStatus: { not: "DISPUTE" },
        },
        _sum: { amountIncVat: true, totalCost: true },
        _count: { _all: true },
      }),
      // Disputed — SupplierBills on dispute
      prisma.supplierBill.aggregate({
        where: { matchStatus: "DISPUTE" },
        _sum: { amountIncVat: true, totalCost: true },
        _count: { _all: true },
      }),
      // Critical tasks
      prisma.task.findMany({
        where: {
          priority: "CRITICAL",
          status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
        },
        select: {
          id: true, taskType: true, priority: true, status: true, dueAt: true,
          generatedReason: true, createdAt: true,
          ticketId: true,
          ticket: { select: { ticketNo: true, title: true, payingCustomer: { select: { name: true } }, site: { select: { siteName: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      // Today's tasks (all priorities, sorted CRITICAL→URGENT→HIGH→NORMAL)
      prisma.task.findMany({
        where: {
          status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
          dueAt: { gte: startOfToday, lt: endOfToday },
        },
        select: {
          id: true, taskType: true, priority: true, status: true, dueAt: true,
          generatedReason: true, supplierBillId: true, ticketLineId: true,
          ticketId: true,
          ticket: { select: { ticketNo: true, title: true, payingCustomer: { select: { name: true } }, site: { select: { siteName: true } } } },
        },
        orderBy: [{ createdAt: "asc" }],
      }),
      // In-transit — POs whose ticket has a BYPASSED / NOT_ARRIVED LogisticsEvent
      prisma.procurementOrder.findMany({
        where: {
          status: { notIn: ["DELIVERED", "CANCELLED", "CLOSED"] },
          ticket: {
            logisticsEvents: {
              some: { stopStatus: { in: ["NOT_ARRIVED", "BYPASSED"] } },
            },
          },
        },
        select: {
          id: true, poNo: true, status: true, issuedAt: true, deliveryDateExpected: true,
          supplier: { select: { name: true } },
          ticket: {
            select: {
              id: true, ticketNo: true, title: true, site: { select: { siteName: true } },
              logisticsEvents: {
                where: { stopStatus: { in: ["NOT_ARRIVED", "BYPASSED"] } },
                orderBy: { timestamp: "desc" }, take: 1,
                select: { stopStatus: true, cpRef: true, driver: true, plannedDate: true, timestamp: true },
              },
            },
          },
        },
        orderBy: { issuedAt: "asc" },
        take: 50,
      }),
      // Uninvoiced deliveries — LogisticsEvents DELIVERED in past 14d, no invoice line
      prisma.logisticsEvent.findMany({
        where: {
          OR: [{ stopStatus: "DELIVERED" }, { deliveredAt: { not: null } }],
          timestamp: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
          ticket: {
            lines: { some: { invoiceLines: { none: {} } } },
          },
        },
        select: {
          id: true, ticketId: true, timestamp: true, deliveredAt: true,
          ticket: {
            select: {
              ticketNo: true, title: true,
              payingCustomer: { select: { name: true } },
              site: { select: { siteName: true } },
              lines: {
                where: { invoiceLines: { none: {} } },
                select: { id: true, description: true, qty: true, actualSaleUnit: true, suggestedSaleUnit: true },
              },
            },
          },
        },
        orderBy: { timestamp: "desc" },
        take: 50,
      }),
      // Disputed bills (detail)
      prisma.supplierBill.findMany({
        where: { matchStatus: "DISPUTE" },
        select: {
          id: true, billNo: true, billDate: true, amountIncVat: true, totalCost: true,
          matchedAt: true, matchNotes: true,
          supplier: { select: { name: true, email: true } },
          tasks: {
            where: {
              taskType: "SUPPLIER_DISPUTE",
              status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
            },
            select: { id: true, priority: true, draftBody: true },
            take: 1,
          },
        },
        orderBy: { matchedAt: "desc" },
        take: 50,
      }),
      // Surplus stock — unresolved
      prisma.stockExcessRecord.findMany({
        where: {
          status: { notIn: ["RESOLVED", "CLOSED", "TRANSFERRED"] },
          excessCost: { gt: 0 },
        },
        select: {
          id: true, excessCost: true, excessQty: true, description: true, createdAt: true,
          canonicalProduct: { select: { code: true, name: true } },
          ticketLine: {
            select: {
              id: true, description: true,
              ticket: { select: { id: true, ticketNo: true, title: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      }),
      // Scheduler recent runs (last 10)
      prisma.schedulerLog.findMany({
        orderBy: { startedAt: "desc" },
        take: 10,
        select: { id: true, job: true, status: true, startedAt: true, finishedAt: true, error: true },
      }),
      // Open tasks by type
      prisma.task.groupBy({
        by: ["taskType"],
        where: { status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] } },
        _count: { _all: true },
      }),
    ]);

    const receivables = Number(unpaidInvoices._sum.totalSell ?? 0);
    const payables = Number(openBills._sum.amountIncVat ?? openBills._sum.totalCost ?? 0);
    const disputed = Number(disputedBillsSum._sum.amountIncVat ?? disputedBillsSum._sum.totalCost ?? 0);
    const available = receivables - payables;

    // Sort today's tasks by priority rank
    const priorityRank = (p: string) =>
      p === "CRITICAL" ? 4 : p === "URGENT" ? 3 : p === "HIGH" ? 2 : p === "NORMAL" ? 1 : 0;
    todayTasks.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));

    const lastRunByJob: Record<string, { status: string; startedAt: Date; finishedAt: Date | null }> = {};
    for (const log of schedulerLogs) {
      if (!lastRunByJob[log.job]) {
        lastRunByJob[log.job] = {
          status: log.status,
          startedAt: log.startedAt,
          finishedAt: log.finishedAt,
        };
      }
    }

    return Response.json({
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      cashPosition: {
        receivables,
        receivablesCount: unpaidInvoices._count._all,
        payables,
        payablesCount: openBills._count._all,
        disputed,
        disputedCount: disputedBillsSum._count._all,
        available,
      },
      criticalTasks,
      todayTasks,
      inTransit,
      uninvoicedDeliveries,
      disputedBills,
      surplusStock,
      systemHealth: {
        lastSchedulerRuns: lastRunByJob,
        recentLogs: schedulerLogs,
        openTasksByType: Object.fromEntries(
          openTasksByType.map((r) => [r.taskType, r._count._all])
        ),
      },
    });
  } catch (err) {
    console.error("[command-centre] failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Command centre query failed" },
      { status: 500 }
    );
  }
}

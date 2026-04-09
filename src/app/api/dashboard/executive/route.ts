import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── ROW 1: Action cards ──────────────────────────────────────────────────

    const [
      inboxCount,
      openTickets,
      quotesAwaitingResponse,
      posAwaitingTickets,
      deliveriesExpected,
      invoicesToSend,
      overdueInvoices,
      paymentsThisMonthData,

      // ── ROW 2: Financial summary ────────────────────────────────────────────
      revenueInvoices,
      costBillLines,
      cashSalesData,
      outstandingInvoices,

      // ── ROW 3: Operations alerts ────────────────────────────────────────────
      inboxNeedsTriage,
      ticketsNoLines,
      linesNoCost,
      ordersNotAcknowledged,
      deliveriesOverdue,
      billsUnmatched,
      returnsAwaitingCredit,
    ] = await Promise.all([
      // 1. Inbox — items needing triage
      prisma.ingestionEvent.count({
        where: { status: { in: ["PARSED", "CLASSIFIED", "NEEDS_TRIAGE"] } },
      }),

      // 2. Open Tickets — not CLOSED or INVOICED
      prisma.ticket.count({
        where: { status: { notIn: ["CLOSED", "INVOICED"] as any } },
      }),

      // 3. Quotes awaiting response — status SENT
      prisma.quote.count({
        where: { status: "SENT" },
      }),

      // 4. POs Awaiting — tickets where poRequired = true and no CustomerPO linked
      prisma.ticket.count({
        where: {
          poRequired: true,
          customerPOs: { none: {} },
          status: { notIn: ["CLOSED", "INVOICED"] as any },
        },
      }),

      // 5. Deliveries Expected — procurement orders ORDERED or ACKNOWLEDGED
      prisma.procurementOrder.count({
        where: { status: { in: ["ORDERED", "ACKNOWLEDGED"] } },
      }),

      // 6. Invoices to Send — DRAFT invoices
      prisma.salesInvoice.count({
        where: { status: "DRAFT" },
      }),

      // 7. Overdue Invoices — SENT and issuedAt > 30 days ago
      prisma.salesInvoice.count({
        where: {
          status: "SENT",
          issuedAt: { lt: thirtyDaysAgo },
        },
      }),

      // 8. Payments Received This Month — invoices paid this month
      prisma.salesInvoice.findMany({
        where: {
          paidAt: { gte: startOfMonth, lt: endOfMonth },
        },
        select: { totalSell: true },
      }),

      // ── ROW 2 queries ─────────────────────────────────────────────────────

      // Revenue — total invoiced this month
      prisma.salesInvoice.findMany({
        where: {
          issuedAt: { gte: startOfMonth, lt: endOfMonth },
          status: { not: "DRAFT" },
        },
        select: { totalSell: true },
      }),

      // Costs — supplier bill lines this month
      prisma.supplierBillLine.findMany({
        where: {
          supplierBill: {
            billDate: { gte: startOfMonth, lt: endOfMonth },
          },
        },
        select: { lineTotal: true },
      }),

      // Cash Sales this month
      prisma.cashSale.findMany({
        where: { receivedAt: { gte: startOfMonth, lt: endOfMonth } },
        select: { receivedAmount: true },
      }),

      // Outstanding Receivables — unpaid invoices (SENT status)
      prisma.salesInvoice.findMany({
        where: { status: "SENT" },
        select: { totalSell: true },
      }),

      // ── ROW 3 queries ─────────────────────────────────────────────────────

      // Inbox items needing triage (same as row 1 inbox, reuse)
      prisma.ingestionEvent.count({
        where: { status: { in: ["PARSED", "CLASSIFIED", "NEEDS_TRIAGE"] } },
      }),

      // Tickets with no lines (empty tickets)
      prisma.ticket.count({
        where: {
          status: { notIn: ["CLOSED", "INVOICED"] as any },
          lines: { none: {} },
        },
      }),

      // Lines with no cost (unpriced) — active ticket lines with no actualCostTotal
      prisma.ticketLine.count({
        where: {
          actualCostTotal: null,
          ticket: { status: { notIn: ["CLOSED", "INVOICED", "CAPTURED"] as any } },
        },
      }),

      // Orders not acknowledged by supplier
      prisma.procurementOrder.count({
        where: { status: "ORDERED" },
      }),

      // Deliveries overdue — procurement orders with deliveryDateExpected in the past and not delivered
      prisma.procurementOrder.count({
        where: {
          status: { in: ["ORDERED", "ACKNOWLEDGED"] },
          deliveryDateExpected: { lt: now },
        },
      }),

      // Bills unmatched
      prisma.supplierBillLine.count({
        where: { allocationStatus: "UNALLOCATED" },
      }),

      // Returns awaiting credit
      prisma.returnLine.count({
        where: { status: "PENDING" },
      }),
    ]);

    // Compute aggregates
    const paymentsThisMonth = paymentsThisMonthData.reduce(
      (sum: number, i: { totalSell: unknown }) => sum + Number(i.totalSell ?? 0), 0
    );
    const revenue = revenueInvoices.reduce(
      (sum: number, i: { totalSell: unknown }) => sum + Number(i.totalSell ?? 0), 0
    );
    const costs = costBillLines.reduce(
      (sum: number, l: { lineTotal: unknown }) => sum + Number(l.lineTotal ?? 0), 0
    );
    const grossProfit = revenue - costs;
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const cashSalesThisMonth = cashSalesData.reduce(
      (sum: number, c: { receivedAmount: unknown }) => sum + Number(c.receivedAmount ?? 0), 0
    );
    const outstandingReceivables = outstandingInvoices.reduce(
      (sum: number, i: { totalSell: unknown }) => sum + Number(i.totalSell ?? 0), 0
    );

    return Response.json({
      // Row 1: Action cards
      actionCards: {
        inboxCount,
        openTickets,
        quotesAwaitingResponse,
        posAwaiting: posAwaitingTickets,
        deliveriesExpected,
        invoicesToSend,
        overdueInvoices,
        paymentsThisMonth,
      },
      // Row 2: Financial summary
      financials: {
        revenue,
        costs,
        grossProfit,
        marginPct,
        cashSalesThisMonth,
        outstandingReceivables,
      },
      // Row 3: Operations alerts
      alerts: {
        inboxNeedsTriage,
        ticketsNoLines,
        linesNoCost,
        ordersNotAcknowledged,
        deliveriesOverdue,
        billsUnmatched,
        returnsAwaitingCredit,
      },
    });
  } catch (error) {
    console.error("Failed to compute executive dashboard:", error);
    return Response.json(
      { error: "Failed to compute executive dashboard" },
      { status: 500 }
    );
  }
}

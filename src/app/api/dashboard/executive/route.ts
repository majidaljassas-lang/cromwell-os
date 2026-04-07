import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      readyToInvoiceLines,
      openRecoveryCasesData,
      activePOs,
      invoicedTicketIds,
      absorbedThisMonth,
      openRecoveryCases,
      cashSalesData,
      unallocatedLines,
      recoverableRevenueLines,
    ] = await Promise.all([
      prisma.ticketLine.findMany({
        where: {
          ticket: {
            status: { in: ["VERIFIED", "LOCKED"] },
            revenueState: { in: ["OPERATIONAL", "REALISED"] },
          },
          actualSaleTotal: { not: null },
        },
        select: { actualSaleTotal: true },
      }),
      prisma.recoveryCase.findMany({
        where: { recoveryStatus: { not: "CLOSED" } },
        select: { stuckValue: true },
      }),
      prisma.customerPO.findMany({
        where: { status: { not: "CLOSED" } },
        select: { poRemainingValue: true },
      }),
      prisma.salesInvoice.findMany({
        where: {
          issuedAt: { gte: startOfMonth, lt: endOfMonth },
          ticket: {
            status: "INVOICED",
            revenueState: { in: ["OPERATIONAL", "REALISED"] },
          },
        },
        select: { ticketId: true },
      }),
      prisma.absorbedCostAllocation.findMany({
        where: { createdAt: { gte: startOfMonth, lt: endOfMonth } },
        select: { amount: true },
      }),
      prisma.recoveryCase.count({ where: { recoveryStatus: { not: "CLOSED" } } }),
      prisma.cashSale.findMany({
        where: { receivedAt: { gte: startOfMonth, lt: endOfMonth } },
        select: { receivedAmount: true },
      }),
      prisma.supplierBillLine.findMany({
        where: { allocationStatus: "UNALLOCATED" },
        select: { lineTotal: true },
      }),
      // Recoverable Revenue: sale totals from RECOVERY_PIPELINE tickets (shown separately)
      prisma.ticketLine.findMany({
        where: {
          ticket: { revenueState: "RECOVERY_PIPELINE" },
          actualSaleTotal: { not: null },
        },
        select: { actualSaleTotal: true },
      }),
    ]);

    const readyToInvoice = readyToInvoiceLines.reduce((sum, l) => sum + Number(l.actualSaleTotal ?? 0), 0);
    const stuckRevenue = openRecoveryCasesData.reduce((sum, r) => sum + Number(r.stuckValue), 0);
    const activePORemaining = activePOs.reduce((sum, po) => sum + Number(po.poRemainingValue), 0);

    const invoicedTicketIdSet = [...new Set(invoicedTicketIds.map((i) => i.ticketId))];
    let grossProfitThisMonth = 0;
    if (invoicedTicketIdSet.length > 0) {
      const invoicedLines = await prisma.ticketLine.findMany({
        where: { ticketId: { in: invoicedTicketIdSet } },
        select: { actualSaleTotal: true, actualCostTotal: true },
      });
      grossProfitThisMonth = invoicedLines.reduce(
        (sum, l) => sum + Number(l.actualSaleTotal ?? 0) - Number(l.actualCostTotal ?? 0),
        0
      );
    }

    const absorbedCostThisMonth = absorbedThisMonth.reduce((sum, a) => sum + Number(a.amount), 0);
    const cashSalesThisMonth = cashSalesData.reduce((sum, c) => sum + Number(c.receivedAmount), 0);
    const unallocatedCostValue = unallocatedLines.reduce((sum, l) => sum + Number(l.lineTotal), 0);
    const recoverableRevenue = recoverableRevenueLines.reduce((sum, l) => sum + Number(l.actualSaleTotal ?? 0), 0);

    return Response.json({
      readyToInvoice,
      stuckRevenue,
      activePORemaining,
      grossProfitThisMonth,
      absorbedCostThisMonth,
      openRecoveryCases,
      cashSalesThisMonth,
      unallocatedCostValue,
      recoverableRevenue,
    });
  } catch (error) {
    console.error("Failed to compute executive dashboard:", error);
    return Response.json({ error: "Failed to compute executive dashboard" }, { status: 500 });
  }
}

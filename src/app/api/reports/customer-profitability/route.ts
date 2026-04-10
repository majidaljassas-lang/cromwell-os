import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [customers, absorbedAllocations] = await Promise.all([
      prisma.customer.findMany({
        include: {
          ticketsAsPayer: {
            include: { lines: { select: { actualSaleTotal: true, actualCostTotal: true } } },
          },
        },
      }),
      prisma.absorbedCostAllocation.findMany({
        include: { ticket: { select: { payingCustomerId: true } } },
      }),
    ]);

    const absorbedByCustomer: Record<string, number> = {};
    for (const alloc of absorbedAllocations) {
      const custId = alloc.ticket.payingCustomerId;
      absorbedByCustomer[custId] = (absorbedByCustomer[custId] ?? 0) + Number(alloc.amount);
    }

    const result = customers.map((customer) => {
      const allLines = customer.ticketsAsPayer.flatMap((t) => t.lines);
      const totalRevenue = allLines.reduce((sum, l) => sum + Number(l.actualSaleTotal ?? 0), 0);
      const totalCost = allLines.reduce((sum, l) => sum + Number(l.actualCostTotal ?? 0), 0);
      const absorbedCosts = absorbedByCustomer[customer.id] ?? 0;
      const profit = totalRevenue - totalCost - absorbedCosts;
      const marginPct = totalRevenue > 0 ? Number(((profit / totalRevenue) * 100).toFixed(2)) : 0;

      return { customerId: customer.id, customerName: customer.name, totalRevenue, totalCost, absorbedCosts, profit, marginPct };
    });

    result.sort((a, b) => b.profit - a.profit);
    return Response.json(result);
  } catch (error) {
    console.error("Failed to compute customer profitability:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to compute customer profitability" }, { status: 500 });
  }
}

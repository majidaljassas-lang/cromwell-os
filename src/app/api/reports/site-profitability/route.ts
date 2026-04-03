import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [sites, absorbedAllocations] = await Promise.all([
      prisma.site.findMany({
        include: { ticketLines: { select: { actualSaleTotal: true, actualCostTotal: true } } },
      }),
      prisma.absorbedCostAllocation.findMany({
        include: { ticket: { select: { siteId: true } } },
      }),
    ]);

    const absorbedBySite: Record<string, number> = {};
    for (const alloc of absorbedAllocations) {
      const siteId = alloc.ticket.siteId;
      if (siteId) {
        absorbedBySite[siteId] = (absorbedBySite[siteId] ?? 0) + Number(alloc.amount);
      }
    }

    const result = sites.map((site) => {
      const totalRevenue = site.ticketLines.reduce((sum, l) => sum + Number(l.actualSaleTotal ?? 0), 0);
      const totalCost = site.ticketLines.reduce((sum, l) => sum + Number(l.actualCostTotal ?? 0), 0);
      const absorbedCosts = absorbedBySite[site.id] ?? 0;
      const profit = totalRevenue - totalCost - absorbedCosts;
      const marginPct = totalRevenue > 0 ? Number(((profit / totalRevenue) * 100).toFixed(2)) : 0;

      return {
        siteId: site.id,
        siteName: site.siteName,
        siteCode: site.siteCode,
        totalRevenue,
        totalCost,
        absorbedCosts,
        profit,
        marginPct,
      };
    });

    result.sort((a, b) => b.profit - a.profit);
    return Response.json(result);
  } catch (error) {
    console.error("Failed to compute site profitability:", error);
    return Response.json({ error: "Failed to compute site profitability" }, { status: 500 });
  }
}

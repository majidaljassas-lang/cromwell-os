import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") ?? "all";

    const now = new Date();
    let dateFilter: { gte?: Date; lt?: Date } | undefined;

    if (period === "this-month") {
      dateFilter = {
        gte: new Date(now.getFullYear(), now.getMonth(), 1),
        lt: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    } else if (period === "last-month") {
      dateFilter = {
        gte: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        lt: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    }

    const where = dateFilter ? { createdAt: dateFilter } : {};

    const allocations = await prisma.absorbedCostAllocation.findMany({
      where,
      include: {
        ticket: { select: { id: true, title: true } },
        supplierBillLine: { select: { description: true, lineTotal: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const byTicket: Record<string, { ticketId: string; ticketTitle: string; totalAbsorbed: number; lineItems: typeof allocations }> = {};

    for (const alloc of allocations) {
      const key = alloc.ticketId;
      if (!byTicket[key]) {
        byTicket[key] = { ticketId: alloc.ticketId, ticketTitle: alloc.ticket.title, totalAbsorbed: 0, lineItems: [] };
      }
      byTicket[key].totalAbsorbed += Number(alloc.amount);
      byTicket[key].lineItems.push(alloc);
    }

    const result = Object.values(byTicket).sort((a, b) => b.totalAbsorbed - a.totalAbsorbed);
    return Response.json(result);
  } catch (error) {
    console.error("Failed to compute absorbed costs report:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to compute absorbed costs report" }, { status: 500 });
  }
}

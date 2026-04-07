import { prisma } from "@/lib/prisma";

/**
 * Commercial Summary — the PRIMARY decision layer.
 * All financials computed from backend. UI must NOT calculate independently.
 *
 * Only includes ACTIVE lines (CAPTURED/PRICED/READY_FOR_QUOTE/ORDERED/FULLY_COSTED/INVOICED).
 * Excludes RAW and MERGED lines.
 */

const ACTIVE_STATUSES = ["CAPTURED", "PRICED", "READY_FOR_QUOTE", "PARTIALLY_ORDERED", "ORDERED", "PARTIALLY_COSTED", "FULLY_COSTED", "INVOICED"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Get active lines only (exclude RAW and MERGED)
    const lines = await prisma.ticketLine.findMany({
      where: {
        ticketId: id,
        status: { in: ACTIVE_STATUSES as ("CAPTURED" | "PRICED" | "READY_FOR_QUOTE" | "PARTIALLY_ORDERED" | "ORDERED" | "PARTIALLY_COSTED" | "FULLY_COSTED" | "INVOICED")[] },
      },
      select: {
        id: true,
        description: true,
        qty: true,
        unit: true,
        status: true,
        supplierName: true,
        supplierReference: true,
        expectedCostUnit: true,
        expectedCostTotal: true,
        actualCostTotal: true,
        actualSaleUnit: true,
        actualSaleTotal: true,
        actualMarginTotal: true,
        varianceTotal: true,
      },
    });

    // Get allocated costs from cost allocations
    const allocations = await prisma.costAllocation.findMany({
      where: { ticketLine: { ticketId: id, status: { in: ACTIVE_STATUSES as ("CAPTURED" | "PRICED" | "READY_FOR_QUOTE" | "PARTIALLY_ORDERED" | "ORDERED" | "PARTIALLY_COSTED" | "FULLY_COSTED" | "INVOICED")[] } } },
      select: { ticketLineId: true, totalCost: true },
    });

    // Build allocated cost map
    const allocatedCostMap: Record<string, number> = {};
    for (const a of allocations) {
      allocatedCostMap[a.ticketLineId] = (allocatedCostMap[a.ticketLineId] || 0) + Number(a.totalCost);
    }

    // Compute line-level profitability
    const lineDetails = lines.map((l) => {
      const sale = Number(l.actualSaleTotal || 0);
      const allocatedCost = allocatedCostMap[l.id] || 0;
      const expectedCost = Number(l.expectedCostTotal || 0);
      const cost = allocatedCost > 0 ? allocatedCost : expectedCost; // prefer allocated, fallback to expected
      const margin = sale - cost;
      const marginPct = sale > 0 ? (margin / sale) * 100 : 0;
      const variance = allocatedCost > 0 && expectedCost > 0 ? allocatedCost - expectedCost : null;

      return {
        id: l.id,
        description: l.description,
        qty: Number(l.qty),
        unit: l.unit,
        status: l.status,
        supplierName: l.supplierName,
        supplierReference: l.supplierReference,
        expectedCost: round2(expectedCost),
        allocatedCost: round2(allocatedCost),
        sale: round2(sale),
        margin: round2(margin),
        marginPct: round2(marginPct),
        variance: variance != null ? round2(variance) : null,
      };
    });

    // Get stock excess and absorbed costs to deduct from job cost
    const stockExcess = await prisma.stockExcessRecord.findMany({
      where: { ticketLine: { ticketId: id } },
      select: { excessCost: true },
    });
    const absorbedCosts = await prisma.absorbedCostAllocation.findMany({
      where: { ticketId: id },
      select: { amount: true },
    });
    const totalStockExcess = round2(stockExcess.reduce((s, r) => s + Number(r.excessCost), 0));
    const totalAbsorbed = round2(absorbedCosts.reduce((s, r) => s + Number(r.amount), 0));

    // Compute totals — deduct stock excess and absorbed from job cost
    const totalSale = round2(lineDetails.reduce((s, l) => s + l.sale, 0));
    const grossCost = round2(lineDetails.reduce((s, l) => s + (l.allocatedCost > 0 ? l.allocatedCost : l.expectedCost), 0));
    const totalCost = round2(grossCost - totalStockExcess);
    const totalMargin = round2(totalSale - totalCost);
    const totalMarginPct = totalSale > 0 ? round2((totalMargin / totalSale) * 100) : 0;
    const totalExpectedCost = round2(lineDetails.reduce((s, l) => s + l.expectedCost, 0));
    const totalAllocatedCost = round2(lineDetails.reduce((s, l) => s + l.allocatedCost, 0));

    return Response.json({
      ticketId: id,
      activeLineCount: lines.length,
      totals: {
        totalSale,
        totalCost,
        totalMargin,
        totalMarginPct,
        totalExpectedCost,
        totalAllocatedCost,
        grossCost,
        totalStockExcess,
        totalAbsorbed,
      },
      lines: lineDetails,
    });
  } catch (error) {
    console.error("Failed to compute commercial summary:", error);
    return Response.json({ error: "Failed to compute" }, { status: 500 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

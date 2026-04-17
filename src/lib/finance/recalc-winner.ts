/**
 * Re-pick the winning TicketLinePrice for a given line and flow its
 * cost back to the TicketLine.
 *
 * Rules:
 *   - lowest costTotal wins by default
 *   - any price with isManual=true beats every auto-discovered price
 *   - if no prices exist, line cost fields are cleared
 *
 * Used by:
 *   - the manual UI (POST/PATCH/DELETE on /api/tickets/[id]/lines/[lineId]/prices)
 *   - the supplier-quote-linker (Phase 13) when an inbound supplier
 *     reply lands a fresh TicketLinePrice on the line.
 */

import { prisma } from "@/lib/prisma";

export async function recalcWinner(ticketLineId: string): Promise<void> {
  const prices = await prisma.ticketLinePrice.findMany({
    where: { ticketLineId },
    orderBy: { costTotal: "asc" },
  });

  if (prices.length === 0) {
    await prisma.ticketLine.update({
      where: { id: ticketLineId },
      data: { expectedCostUnit: null, expectedCostTotal: null, supplierName: null, supplierId: null },
    });
    return;
  }

  const manual = prices.find((p) => p.isManual);
  const winner = manual ?? prices[0];

  await prisma.ticketLinePrice.updateMany({
    where: { ticketLineId, isWinner: true },
    data: { isWinner: false },
  });
  await prisma.ticketLinePrice.update({
    where: { id: winner.id },
    data: { isWinner: true },
  });

  await prisma.ticketLine.update({
    where: { id: ticketLineId },
    data: {
      expectedCostUnit: winner.costPerUnit,
      expectedCostTotal: winner.costTotal,
      supplierName: winner.supplierName,
      supplierId: winner.supplierId,
    },
  });
}

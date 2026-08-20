/**
 * POST /api/ticket-lines/apply-price
 *
 * Apply the same price to multiple ticket lines (matching items across sections).
 * Body: { lineIds: string[], expectedCostUnit?: number, actualSaleUnit?: number, supplierName?: string }
 */

import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const { lineIds, expectedCostUnit, actualSaleUnit, supplierName } = body;

  if (!lineIds || !Array.isArray(lineIds) || lineIds.length === 0) {
    return Response.json({ error: "lineIds required" }, { status: 400 });
  }

  let updated = 0;
  let skipped = 0;
  for (const id of lineIds) {
    const line = await prisma.ticketLine.findUnique({ where: { id }, select: { qty: true, priceOverride: true } });
    if (!line) continue;

    const qty = Number(line.qty);
    const data: Record<string, unknown> = {};
    // Locked lines keep their cost/supplier; sale-side fields still cascade.
    const allowPricing = !line.priceOverride;
    if (allowPricing && expectedCostUnit !== undefined) {
      data.expectedCostUnit = expectedCostUnit;
      data.expectedCostTotal = Math.round(expectedCostUnit * qty * 100) / 100;
    }
    if (actualSaleUnit !== undefined) {
      data.actualSaleUnit = actualSaleUnit;
      data.actualSaleTotal = Math.round(actualSaleUnit * qty * 100) / 100;
    }
    if (allowPricing && supplierName !== undefined) data.supplierName = supplierName;

    if (Object.keys(data).length > 0) {
      await prisma.ticketLine.update({ where: { id }, data });
      updated++;
    } else if (line.priceOverride && (expectedCostUnit !== undefined || supplierName !== undefined)) {
      skipped++;
    }
  }

  return Response.json({ ok: true, updated, skipped });
}

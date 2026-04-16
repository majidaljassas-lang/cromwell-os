/**
 * GET  /api/tickets/:id/lines/:lineId/allocate-stock — suggest matching stock items
 * POST /api/tickets/:id/lines/:lineId/allocate-stock — allocate stock to this line
 *
 * POST body: { stockItemId: string, qty?: number }
 * If qty not provided, uses the full ticket line qty or remaining stock, whichever is less.
 */

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const { id, lineId } = await params;

  const line = await prisma.ticketLine.findFirst({
    where: { id: lineId, ticketId: id },
    select: { id: true, description: true, qty: true },
  });
  if (!line) return Response.json({ error: "line not found" }, { status: 404 });

  // Find matching stock items — fuzzy match on description keywords
  const words = line.description.toLowerCase().split(/\s+/).filter(w => w.length >= 3);

  const allStock = await prisma.stockItem.findMany({
    where: { isActive: true, outcome: "HOLDING", qtyOnHand: { gt: 0 } },
    select: { id: true, description: true, qtyOnHand: true, costPerUnit: true, supplierName: true, productCode: true },
  });

  // Score each stock item
  const scored = allStock.map((s) => {
    const sWords = s.description.toLowerCase().split(/\s+/);
    const matches = words.filter(w => sWords.some(sw => sw.includes(w) || w.includes(sw)));
    const score = matches.length;
    return { ...s, score, qtyOnHand: Number(s.qtyOnHand), costPerUnit: Number(s.costPerUnit) };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  return Response.json({
    line: { id: line.id, description: line.description, qty: Number(line.qty) },
    suggestions: scored.slice(0, 10),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const { id, lineId } = await params;
  const body = await request.json();
  const { stockItemId, qty: requestedQty } = body;

  if (!stockItemId) return Response.json({ error: "stockItemId required" }, { status: 400 });

  const line = await prisma.ticketLine.findFirst({
    where: { id: lineId, ticketId: id },
    select: { id: true, description: true, qty: true, ticketId: true, payingCustomerId: true },
  });
  if (!line) return Response.json({ error: "line not found" }, { status: 404 });

  const stockItem = await prisma.stockItem.findUnique({
    where: { id: stockItemId },
    select: { id: true, description: true, qtyOnHand: true, costPerUnit: true, supplierName: true },
  });
  if (!stockItem) return Response.json({ error: "stock item not found" }, { status: 404 });

  const lineQty = Number(line.qty);
  const available = Number(stockItem.qtyOnHand);
  const allocateQty = requestedQty ?? Math.min(lineQty, available);

  if (allocateQty > available) {
    return Response.json({ error: `Only ${available} available in stock` }, { status: 400 });
  }

  const costPerUnit = Number(stockItem.costPerUnit);
  const totalCost = Math.round(allocateQty * costPerUnit * 100) / 100;

  // Create StockUsage record
  await prisma.stockUsage.create({
    data: {
      stockItemId: stockItem.id,
      ticketLineId: line.id,
      qtyUsed: allocateQty,
      costPerUnit,
      totalCost,
      notes: `Allocated from stock: ${stockItem.description} (${stockItem.supplierName ?? "unknown supplier"})`,
    },
  });

  // Deduct from stock
  await prisma.stockItem.update({
    where: { id: stockItem.id },
    data: {
      qtyOnHand: available - allocateQty,
      outcome: available - allocateQty <= 0 ? "DEPLETED" : "HOLDING",
      outcomeDate: available - allocateQty <= 0 ? new Date() : undefined,
    },
  });

  // Update ticket line — set fromStock, cost, supplier from stock item
  const existingFromStock = Number((await prisma.ticketLine.findUnique({ where: { id: lineId }, select: { fromStock: true } }))?.fromStock ?? 0);
  await prisma.ticketLine.update({
    where: { id: lineId },
    data: {
      fromStock: existingFromStock + allocateQty,
      toOrder: Math.max(0, lineQty - existingFromStock - allocateQty),
      expectedCostUnit: costPerUnit,
      expectedCostTotal: totalCost,
      supplierName: stockItem.supplierName,
      status: existingFromStock + allocateQty >= lineQty ? "ORDERED" : "CAPTURED",
    },
  });

  // Log event on ticket
  await prisma.event.create({
    data: {
      ticketId: line.ticketId,
      eventType: "COMMS_RECEIVED",
      timestamp: new Date(),
      notes: `Stock allocated: ${allocateQty}x ${stockItem.description} @ £${costPerUnit.toFixed(2)} = £${totalCost.toFixed(2)} (from ${stockItem.supplierName ?? "stock"})`,
    },
  });

  // Update ticket lastActivityAt
  await prisma.ticket.update({
    where: { id },
    data: { lastActivityAt: new Date() },
  });

  return Response.json({
    ok: true,
    allocated: allocateQty,
    costPerUnit,
    totalCost,
    stockRemaining: available - allocateQty,
  });
}

/**
 * POST   /api/tickets/:id/lines/:lineId/prices  — add a supplier price
 * PATCH  /api/tickets/:id/lines/:lineId/prices  — update a price (body.priceId required)
 * DELETE /api/tickets/:id/lines/:lineId/prices  — delete a price (body.priceId required)
 *
 * After every mutation the winner is recalculated:
 *   - lowest costTotal is auto-selected unless a manual override exists
 *   - winner's cost flows to TicketLine.expectedCostUnit / expectedCostTotal
 */

import { prisma } from "@/lib/prisma";

// ── Recalculate winner after any price mutation ─────────────────────

async function recalcWinner(ticketLineId: string) {
  const prices = await prisma.ticketLinePrice.findMany({
    where: { ticketLineId },
    orderBy: { costTotal: "asc" },
  });

  if (prices.length === 0) {
    // No prices left — clear line cost fields
    await prisma.ticketLine.update({
      where: { id: ticketLineId },
      data: { expectedCostUnit: null, expectedCostTotal: null, supplierName: null, supplierId: null },
    });
    return;
  }

  // Manual override takes priority
  const manual = prices.find((p) => p.isManual);
  const winner = manual ?? prices[0]; // prices[0] is lowest costTotal

  // Reset all to non-winner, then set the winner
  await prisma.ticketLinePrice.updateMany({
    where: { ticketLineId, isWinner: true },
    data: { isWinner: false },
  });
  await prisma.ticketLinePrice.update({
    where: { id: winner.id },
    data: { isWinner: true },
  });

  // Flow winner cost to TicketLine
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

// ── POST — add a new supplier price ─────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const { id, lineId } = await params;

  // Verify the line belongs to this ticket
  const line = await prisma.ticketLine.findFirst({
    where: { id: lineId, ticketId: id },
    select: { id: true, qty: true },
  });
  if (!line) return Response.json({ error: "line not found" }, { status: 404 });

  const body = await request.json();
  const { supplierName, supplierId, costPerUnit, leadTimeDays, notes, isManual } = body;

  if (!supplierName || costPerUnit == null) {
    return Response.json({ error: "supplierName and costPerUnit required" }, { status: 400 });
  }

  const qty = Number(line.qty);
  const cpu = Number(costPerUnit);
  const costTotal = Math.round(qty * cpu * 100) / 100;

  // If setting manual, clear any existing manual flag
  if (isManual) {
    await prisma.ticketLinePrice.updateMany({
      where: { ticketLineId: lineId, isManual: true },
      data: { isManual: false },
    });
  }

  const price = await prisma.ticketLinePrice.create({
    data: {
      ticketLineId: lineId,
      supplierName,
      supplierId: supplierId || null,
      costPerUnit: cpu,
      costTotal,
      leadTimeDays: leadTimeDays ?? null,
      notes: notes || null,
      isManual: isManual ?? false,
    },
  });

  await recalcWinner(lineId);

  return Response.json({ ok: true, price });
}

// ── PATCH — update an existing price ────────────────────────────────

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const { id, lineId } = await params;
  const body = await request.json();
  const { priceId, supplierName, supplierId, costPerUnit, leadTimeDays, notes, isManual } = body;

  if (!priceId) return Response.json({ error: "priceId required" }, { status: 400 });

  const existing = await prisma.ticketLinePrice.findFirst({
    where: { id: priceId, ticketLineId: lineId },
    include: { ticketLine: { select: { ticketId: true, qty: true } } },
  });
  if (!existing || existing.ticketLine.ticketId !== id) {
    return Response.json({ error: "price not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (supplierName !== undefined) data.supplierName = supplierName;
  if (supplierId !== undefined) data.supplierId = supplierId || null;
  if (notes !== undefined) data.notes = notes || null;
  if (leadTimeDays !== undefined) data.leadTimeDays = leadTimeDays;

  if (costPerUnit !== undefined) {
    const qty = Number(existing.ticketLine.qty);
    const cpu = Number(costPerUnit);
    data.costPerUnit = cpu;
    data.costTotal = Math.round(qty * cpu * 100) / 100;
  }

  if (isManual !== undefined) {
    data.isManual = isManual;
    if (isManual) {
      // Clear other manual flags
      await prisma.ticketLinePrice.updateMany({
        where: { ticketLineId: lineId, isManual: true, id: { not: priceId } },
        data: { isManual: false },
      });
    }
  }

  const updated = await prisma.ticketLinePrice.update({
    where: { id: priceId },
    data,
  });

  await recalcWinner(lineId);

  return Response.json({ ok: true, price: updated });
}

// ── DELETE — remove a price ─────────────────────────────────────────

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const { id, lineId } = await params;
  const body = await request.json();
  const { priceId } = body;

  if (!priceId) return Response.json({ error: "priceId required" }, { status: 400 });

  const existing = await prisma.ticketLinePrice.findFirst({
    where: { id: priceId, ticketLineId: lineId },
    include: { ticketLine: { select: { ticketId: true } } },
  });
  if (!existing || existing.ticketLine.ticketId !== id) {
    return Response.json({ error: "price not found" }, { status: 404 });
  }

  await prisma.ticketLinePrice.delete({ where: { id: priceId } });
  await recalcWinner(lineId);

  return Response.json({ ok: true });
}

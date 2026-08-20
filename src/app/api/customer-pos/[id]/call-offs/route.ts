/**
 * Customer call-off → internal planning record only.
 *
 * A CallOff captures what Cromwell intends to deliver against a CustomerPO.
 * It does NOT create an invoice and does NOT decrement PO consumed value.
 * Physical delivery is recorded later via a DeliveryNote (scoped by callOffId).
 * Invoicing is triggered separately via POST /api/call-offs/[id]/invoice,
 * gated by what's actually been delivered on DNs.
 *
 * Body: {
 *   callOffDate?: string;     // ISO date; defaults to now
 *   source?: string;          // free text — "WhatsApp from Nour", etc.
 *   notes?: string;
 *   lines: Array<{
 *     ticketLineId: string;
 *     qty: number;             // requested qty for this call-off
 *     unitPrice?: number;      // overrides PO line agreedUnitPrice
 *   }>;
 * }
 *
 * Per line:
 *   - validates ticketLineId belongs to a PO line on this PO
 *   - validates qty ≤ remaining (PO line qty − sum of prior CallOffLine.requestedQty on that line)
 *
 * Side effects (one transaction):
 *   - 1 CallOff with N CallOffLine rows (requestedQty per line; invoicedQty starts at 0)
 *   - CallOff.status = OPEN
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { syncPoConsumptionFromCallOffs } from "@/lib/finance/po-drawdown";

type InputLine = { ticketLineId: string; qty: number; unitPrice?: number };
type Body = {
  callOffDate?: unknown;
  source?: unknown;
  notes?: unknown;
  lines?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const inputLines: InputLine[] = Array.isArray(body.lines)
    ? body.lines.flatMap((l) => {
        if (!l || typeof l !== "object") return [];
        const ll = l as Record<string, unknown>;
        if (typeof ll.ticketLineId !== "string") return [];
        const qty = Number(ll.qty);
        if (!Number.isFinite(qty) || qty <= 0) return [];
        const unitPrice = Number.isFinite(Number(ll.unitPrice)) ? Number(ll.unitPrice) : undefined;
        return [{ ticketLineId: ll.ticketLineId, qty, unitPrice }];
      })
    : [];

  if (inputLines.length === 0) {
    return Response.json({ error: "lines is required and must be non-empty" }, { status: 400 });
  }

  const callOffDate =
    typeof body.callOffDate === "string" && body.callOffDate.length > 0
      ? new Date(body.callOffDate)
      : new Date();
  const source = typeof body.source === "string" ? body.source : null;
  const notes = typeof body.notes === "string" ? body.notes : null;

  const po = await prisma.customerPO.findUnique({
    where: { id: poId },
    include: {
      lines: { include: { ticketLine: { select: { id: true, qty: true, description: true } } } },
    },
  });
  if (!po) return Response.json({ error: "PO not found" }, { status: 404 });
  if (!po.ticketId)
    return Response.json({ error: "PO has no linked ticket — cannot call off" }, { status: 422 });

  const poLineByTLine = new Map<string, (typeof po.lines)[number]>();
  for (const pl of po.lines) {
    if (pl.ticketLineId) poLineByTLine.set(pl.ticketLineId, pl);
  }

  // Sum prior CallOffLine.requestedQty per ticketLine on this PO so we enforce
  // that total requested across call-offs ≤ PO line qty.
  const tlIds = Array.from(poLineByTLine.keys());
  const priorByTLine = new Map<string, number>();
  if (tlIds.length > 0) {
    const groups = await prisma.callOffLine.groupBy({
      by: ["ticketLineId"],
      where: {
        ticketLineId: { in: tlIds },
        callOff: { customerPOId: poId },
      },
      _sum: { requestedQty: true },
    });
    for (const g of groups) {
      if (g.ticketLineId) priorByTLine.set(g.ticketLineId, Number(g._sum.requestedQty ?? 0));
    }
  }

  type Resolved = {
    poLineId: string;
    ticketLineId: string;
    description: string;
    requestedQty: number;
    unitPrice: number;
    displayOrder: number;
  };
  const resolved: Resolved[] = [];
  const overQty: Array<{ ticketLineId: string; description: string; requested: number; remaining: number }> = [];

  let seq = 0;
  for (const il of inputLines) {
    seq++;
    const pl = poLineByTLine.get(il.ticketLineId);
    if (!pl) {
      return Response.json(
        { error: `ticketLineId not on this PO: ${il.ticketLineId}` },
        { status: 400 }
      );
    }
    const lineQty = Number(pl.qty);
    const prior = priorByTLine.get(il.ticketLineId) ?? 0;
    const remaining = lineQty - prior;
    if (il.qty > remaining + 1e-6) {
      overQty.push({
        ticketLineId: il.ticketLineId,
        description: pl.description,
        requested: il.qty,
        remaining,
      });
      continue;
    }
    const unitPrice = il.unitPrice ?? Number(pl.agreedUnitPrice);
    resolved.push({
      poLineId: pl.id,
      ticketLineId: il.ticketLineId,
      description: pl.description,
      requestedQty: il.qty,
      unitPrice,
      displayOrder: seq,
    });
  }

  if (overQty.length > 0) {
    return Response.json(
      { error: "Some lines exceed remaining qty on the PO line", overQty },
      { status: 422 }
    );
  }

  const callOff = await prisma.callOff.create({
    data: {
      customerPOId: poId,
      ticketId: po.ticketId!,
      callOffDate,
      source,
      notes,
      status: "OPEN",
      lines: {
        create: resolved.map((r) => ({
          customerPOLineId: r.poLineId,
          ticketLineId: r.ticketLineId,
          description: r.description,
          requestedQty: new Prisma.Decimal(r.requestedQty),
          invoicedQty: new Prisma.Decimal(0),
          agreedUnitPrice: new Prisma.Decimal(r.unitPrice),
          displayOrder: r.displayOrder,
        })),
      },
    },
    select: { id: true, callOffNo: true },
  });

  // Keep the PO's consumed/remaining counters in step with the call-off lines
  // (source of truth = sum of CallOffLine.requestedQty), so the call-off picker,
  // PO register and P&L all read a current figure rather than a stale zero.
  await syncPoConsumptionFromCallOffs(poId);

  const totalRequestedSell = Number(
    resolved.reduce((s, r) => s + r.requestedQty * r.unitPrice, 0).toFixed(2)
  );
  return Response.json({
    ok: true,
    callOffId: callOff.id,
    callOffNo: callOff.callOffNo,
    callOffStatus: "OPEN",
    linesCreated: resolved.length,
    totalRequestedSell,
  });
}

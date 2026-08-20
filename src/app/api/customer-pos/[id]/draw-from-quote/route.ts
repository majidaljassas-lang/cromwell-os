/**
 * POST /api/customer-pos/[id]/draw-from-quote
 *
 * One-click link: draw an APPROVED quote down against a fixed-limit materials
 * drawdown PO. Creates one MaterialsDrawdownEntry per QuoteLine (sell from the
 * quote, cost from the ticket line) and depletes the PO's remaining budget.
 *
 * Used for standing drawdown POs (e.g. St Georges 352177073) where the client
 * sends RFQs → each becomes its own ticket + approved quote → drawn against the
 * same PO until the limit runs out.
 *
 * Body: { quoteId: string }
 *
 * Guards:
 *   - PO must be poType = DRAWDOWN_MATERIALS
 *   - Quote must be status = APPROVED and belong to the PO's customer
 *   - No line of this quote may already have been drawn against this PO
 *   - HARD BLOCK (412) if the quote's sell total exceeds remaining budget
 *     (remaining = poLimitValue − poConsumedValue, recomputed — the stored
 *     poRemainingValue can be stale until the first write)
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

const EPS = 1e-6;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;

  let body: { quoteId?: unknown };
  try {
    body = (await request.json()) as { quoteId?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const quoteId = typeof body.quoteId === "string" ? body.quoteId : "";
  if (!quoteId) {
    return Response.json({ error: "quoteId is required" }, { status: 400 });
  }

  const po = await prisma.customerPO.findUnique({
    where: { id: poId },
    select: {
      id: true,
      poNo: true,
      poType: true,
      customerId: true,
      poLimitValue: true,
      poConsumedValue: true,
      overheadPct: true,
    },
  });
  if (!po) return Response.json({ error: "PO not found" }, { status: 404 });
  if (po.poType !== "DRAWDOWN_MATERIALS") {
    return Response.json(
      { error: "PO is not a materials drawdown PO", poType: po.poType },
      { status: 422 }
    );
  }

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      quoteNo: true,
      status: true,
      customerId: true,
      ticketId: true,
      lines: {
        select: {
          id: true,
          ticketLineId: true,
          description: true,
          qty: true,
          unitPrice: true,
          lineTotal: true,
          sortOrder: true,
          ticketLine: {
            select: { expectedCostUnit: true, expectedCostTotal: true, actualCostTotal: true },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!quote) return Response.json({ error: "Quote not found" }, { status: 404 });
  if (quote.status !== "APPROVED") {
    return Response.json(
      { error: "Quote is not approved — only APPROVED quotes can be drawn down", status: quote.status },
      { status: 422 }
    );
  }
  if (quote.customerId !== po.customerId) {
    return Response.json(
      { error: "Quote belongs to a different customer than the PO" },
      { status: 422 }
    );
  }
  if (quote.lines.length === 0) {
    return Response.json({ error: "Quote has no lines" }, { status: 422 });
  }

  // Double-draw guard: block if any line of this quote is already drawn on this PO.
  const tlIds = quote.lines.map((l) => l.ticketLineId).filter(Boolean);
  if (tlIds.length > 0) {
    const already = await prisma.materialsDrawdownEntry.count({
      where: { customerPOId: poId, ticketLineId: { in: tlIds } },
    });
    if (already > 0) {
      return Response.json(
        { error: `Quote ${quote.quoteNo} has already been drawn down against this PO` },
        { status: 409 }
      );
    }
  }

  // Hard block on over-limit. Recompute remaining from limit − consumed.
  const limit = Number(po.poLimitValue) || 0;
  const consumed = Number(po.poConsumedValue) || 0;
  const remaining = limit - consumed;
  const sellTotal = quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  if (sellTotal > remaining + EPS) {
    return Response.json(
      {
        error: "OVER_LIMIT",
        message: `This quote (£${sellTotal.toFixed(2)}) exceeds the remaining PO budget (£${remaining.toFixed(2)}).`,
        requested: Number(sellTotal.toFixed(2)),
        remaining: Number(remaining.toFixed(2)),
        limit,
        consumed,
      },
      { status: 412 }
    );
  }

  const overheadPct = Number(po.overheadPct) || 10;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const entries = [];
    for (const l of quote.lines) {
      const sellValue = Number(l.lineTotal);
      const costValueActual =
        l.ticketLine?.actualCostTotal != null
          ? Number(l.ticketLine.actualCostTotal)
          : l.ticketLine?.expectedCostTotal != null
            ? Number(l.ticketLine.expectedCostTotal)
            : null;
      const overheadValue = (sellValue * overheadPct) / 100;
      const grossProfitValue = sellValue - (costValueActual ?? 0) - overheadValue;

      const entry = await tx.materialsDrawdownEntry.create({
        data: {
          customerPOId: poId,
          ticketId: quote.ticketId,
          ticketLineId: l.ticketLineId,
          drawdownDate: now,
          description: l.description,
          qty: l.qty,
          unitSell: l.unitPrice,
          sellValue: new Prisma.Decimal(sellValue),
          unitCostExpected: l.ticketLine?.expectedCostUnit ?? null,
          costValueActual: costValueActual != null ? new Prisma.Decimal(costValueActual) : null,
          overheadPct: new Prisma.Decimal(overheadPct),
          overheadValue: new Prisma.Decimal(overheadValue),
          grossProfitValue: new Prisma.Decimal(grossProfitValue),
          status: "LOGGED",
        },
        select: { id: true },
      });
      entries.push(entry.id);
    }

    const newConsumed = consumed + sellTotal;
    await tx.customerPO.update({
      where: { id: poId },
      data: {
        poConsumedValue: new Prisma.Decimal(newConsumed),
        poRemainingValue: new Prisma.Decimal(limit - newConsumed),
      },
    });

    return { entryIds: entries, newConsumed };
  });

  return Response.json({
    ok: true,
    poNo: po.poNo,
    quoteNo: quote.quoteNo,
    linesDrawn: result.entryIds.length,
    drawnValue: Number(sellTotal.toFixed(2)),
    poConsumedValue: Number(result.newConsumed.toFixed(2)),
    poRemainingValue: Number((limit - result.newConsumed).toFixed(2)),
  });
}

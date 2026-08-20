/**
 * Recompute consumedQty / consumedValue / remainingQty / remainingValue on
 * every CustomerPOLine of a PO from its MaterialsDrawdownEntry rows.
 * Use it after manual data fixes or when migrating older POs that pre-date
 * per-line tracking.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;

  const po = await prisma.customerPO.findUnique({
    where: { id: poId },
    include: { lines: true },
  });
  if (!po) return Response.json({ error: "PO not found" }, { status: 404 });

  const drawdowns = await prisma.materialsDrawdownEntry.findMany({
    where: { customerPOId: poId },
    select: { ticketLineId: true, qty: true, sellValue: true },
  });

  const sumByTLine = new Map<string, { qty: number; value: number }>();
  for (const d of drawdowns) {
    if (!d.ticketLineId) continue;
    const cur = sumByTLine.get(d.ticketLineId) ?? { qty: 0, value: 0 };
    cur.qty += Number(d.qty ?? 0);
    cur.value += Number(d.sellValue ?? 0);
    sumByTLine.set(d.ticketLineId, cur);
  }

  let updated = 0;
  let totalConsumed = 0;
  await prisma.$transaction(async (tx) => {
    for (const pl of po.lines) {
      const consumed = pl.ticketLineId
        ? sumByTLine.get(pl.ticketLineId) ?? { qty: 0, value: 0 }
        : { qty: 0, value: 0 };
      const lineQty = Number(pl.qty ?? 0);
      const lineTotal = Number(pl.agreedTotal ?? 0);
      const remainingQty = Math.max(0, lineQty - consumed.qty);
      const remainingValue = Math.max(0, lineTotal - consumed.value);
      await tx.customerPOLine.update({
        where: { id: pl.id },
        data: {
          consumedQty: new Prisma.Decimal(consumed.qty),
          consumedValue: new Prisma.Decimal(Number(consumed.value.toFixed(2))),
          remainingQty: new Prisma.Decimal(remainingQty),
          remainingValue: new Prisma.Decimal(Number(remainingValue.toFixed(2))),
        },
      });
      updated++;
      totalConsumed += consumed.value;
    }

    const limit = Number(po.poLimitValue ?? 0);
    await tx.customerPO.update({
      where: { id: poId },
      data: {
        poConsumedValue: new Prisma.Decimal(Number(totalConsumed.toFixed(2))),
        poRemainingValue: new Prisma.Decimal(Number((limit - totalConsumed).toFixed(2))),
      },
    });
  });

  return Response.json({
    ok: true,
    linesUpdated: updated,
    poConsumedValue: Number(totalConsumed.toFixed(2)),
  });
}

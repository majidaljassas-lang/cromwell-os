/**
 * Group-PO drawdown.
 *
 * A "group PO" (e.g. Criterion Capital / Criterion Developments PO 11785) holds
 * pooled quantities across its CustomerPOLines. A drawdown calls off a chunk of
 * that pool and bills it to the entity that owns the order at that moment —
 * which may differ from the PO's own customer (a subsidiary pays per project).
 *
 * Each drawdown creates ONE CallOff carrying its own bill-to entity + delivery
 * site (no ticket required), with CallOffLines drawing requestedQty straight
 * from CustomerPOLines. The pool's consumed/remaining is recomputed from the
 * sum of all CallOffLine.requestedQty on each line, so it can never drift.
 *
 * It does NOT invoice and does NOT touch the existing single-ticket call-off
 * flow (POST /api/customer-pos/[id]/call-offs) — that path is unchanged.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export type DrawdownInputLine = {
  customerPOLineId: string;
  qty: number;
  unitPrice?: number; // overrides the PO line's agreedUnitPrice
};

export type DrawdownInput = {
  billToCustomerId: string;
  siteId: string;
  callOffDate?: Date;
  source?: string | null;
  notes?: string | null;
  lines: DrawdownInputLine[];
};

export type DrawdownResult =
  | { ok: true; status: 201; callOffId: string; callOffNo: number; netValue: number; pool: PoolLine[] }
  | { ok: false; status: number; error: string; detail?: unknown };

type PoolLine = { customerPOLineId: string; description: string; ordered: number; consumed: number; remaining: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Recompute a PO's consumed/remaining counters from the single source of truth:
 * the sum of CallOffLine.requestedQty per CustomerPOLine across every call-off
 * on the PO. Safe to call after any call-off write (or as a backfill) — it
 * always overwrites from the sum, so the counters can never drift.
 */
export async function syncPoConsumptionFromCallOffs(poId: string): Promise<void> {
  const po = await prisma.customerPO.findUnique({
    where: { id: poId },
    include: { lines: true },
  });
  if (!po) return;

  const grouped = await prisma.callOffLine.groupBy({
    by: ["customerPOLineId"],
    where: { callOff: { customerPOId: poId } },
    _sum: { requestedQty: true },
  });
  const consumedByLine = new Map<string, number>();
  for (const g of grouped) consumedByLine.set(g.customerPOLineId, Number(g._sum.requestedQty ?? 0));

  let totalConsumedValue = 0;
  for (const pl of po.lines) {
    const consumed = consumedByLine.get(pl.id) ?? 0;
    const ordered = Number(pl.qty ?? 0);
    const remaining = ordered - consumed;
    const unit = Number(pl.agreedUnitPrice ?? 0);
    const consumedValue = round2(consumed * unit);
    totalConsumedValue += consumedValue;
    await prisma.customerPOLine.update({
      where: { id: pl.id },
      data: {
        consumedQty: new Prisma.Decimal(consumed),
        remainingQty: new Prisma.Decimal(remaining),
        consumedValue: new Prisma.Decimal(consumedValue),
        remainingValue: new Prisma.Decimal(round2(remaining * unit)),
      },
    });
  }

  const totalValue = Number(po.totalValue ?? po.poLimitValue ?? 0);
  await prisma.customerPO.update({
    where: { id: poId },
    data: {
      poConsumedValue: new Prisma.Decimal(round2(totalConsumedValue)),
      poRemainingValue: new Prisma.Decimal(round2(totalValue - totalConsumedValue)),
    },
  });
}

export async function recordDrawdown(poId: string, input: DrawdownInput): Promise<DrawdownResult> {
  if (!input.billToCustomerId) return { ok: false, status: 400, error: "billToCustomerId is required" };
  if (!input.siteId) return { ok: false, status: 400, error: "siteId is required" };

  const lines = (input.lines ?? []).filter(
    (l) => l && typeof l.customerPOLineId === "string" && Number.isFinite(Number(l.qty)) && Number(l.qty) > 0
  );
  if (lines.length === 0) return { ok: false, status: 400, error: "lines is required and must be non-empty" };

  const po = await prisma.customerPO.findUnique({
    where: { id: poId },
    include: { lines: true },
  });
  if (!po) return { ok: false, status: 404, error: "PO not found" };

  // Bill-to entity must exist and be commercially linked to the site (your
  // Customer↔Site SiteCommercialLink rule), so we never bill a site to an
  // entity that has no commercial relationship with it.
  const billTo = await prisma.customer.findUnique({ where: { id: input.billToCustomerId }, select: { id: true } });
  if (!billTo) return { ok: false, status: 400, error: "billToCustomerId not found" };

  const link = await prisma.siteCommercialLink.findFirst({
    where: { siteId: input.siteId, customerId: input.billToCustomerId, isActive: true },
    select: { id: true },
  });
  if (!link) {
    return {
      ok: false,
      status: 422,
      error: "No active commercial link between this site and bill-to entity — link them before drawing down",
    };
  }

  const poLineById = new Map(po.lines.map((l) => [l.id, l]));
  for (const l of lines) {
    if (!poLineById.has(l.customerPOLineId)) {
      return { ok: false, status: 400, error: `customerPOLineId not on this PO: ${l.customerPOLineId}` };
    }
  }

  // Prior drawn qty per PO line across ALL call-offs on this PO.
  const priorByLine = new Map<string, number>();
  const grouped = await prisma.callOffLine.groupBy({
    by: ["customerPOLineId"],
    where: { customerPOLineId: { in: Array.from(poLineById.keys()) }, callOff: { customerPOId: poId } },
    _sum: { requestedQty: true },
  });
  for (const g of grouped) priorByLine.set(g.customerPOLineId, Number(g._sum.requestedQty ?? 0));

  const overQty: Array<{ customerPOLineId: string; description: string; requested: number; remaining: number }> = [];
  for (const l of lines) {
    const pl = poLineById.get(l.customerPOLineId)!;
    const ordered = Number(pl.qty ?? 0);
    const remaining = ordered - (priorByLine.get(l.customerPOLineId) ?? 0);
    if (Number(l.qty) > remaining + 1e-6) {
      overQty.push({ customerPOLineId: l.customerPOLineId, description: pl.description, requested: Number(l.qty), remaining });
    }
  }
  if (overQty.length > 0) {
    return { ok: false, status: 422, error: "Some lines exceed remaining qty on the pool", detail: overQty };
  }

  const callOff = await prisma.callOff.create({
    data: {
      customerPO: { connect: { id: poId } },
      // ticket / ticketLine intentionally omitted — group drawdowns are ticketless.
      billToCustomerId: input.billToCustomerId,
      siteId: input.siteId,
      callOffDate: input.callOffDate ?? new Date(),
      source: input.source ?? null,
      notes: input.notes ?? null,
      status: "OPEN",
      lines: {
        create: lines.map((l, i) => {
          const pl = poLineById.get(l.customerPOLineId)!;
          const unitPrice = l.unitPrice ?? Number(pl.agreedUnitPrice ?? 0);
          return {
            customerPOLine: { connect: { id: l.customerPOLineId } },
            description: pl.description,
            requestedQty: new Prisma.Decimal(l.qty),
            invoicedQty: new Prisma.Decimal(0),
            agreedUnitPrice: new Prisma.Decimal(unitPrice),
            displayOrder: i + 1,
          };
        }),
      },
    },
    select: { id: true, callOffNo: true },
  });

  // Recompute pool consumed/remaining for the touched lines from source of truth.
  const touched = Array.from(new Set(lines.map((l) => l.customerPOLineId)));
  const pool: PoolLine[] = [];
  for (const lineId of touched) {
    const pl = poLineById.get(lineId)!;
    const agg = await prisma.callOffLine.aggregate({
      where: { customerPOLineId: lineId, callOff: { customerPOId: poId } },
      _sum: { requestedQty: true },
    });
    const consumed = Number(agg._sum.requestedQty ?? 0);
    const ordered = Number(pl.qty ?? 0);
    const remaining = ordered - consumed;
    const unit = Number(pl.agreedUnitPrice ?? 0);
    await prisma.customerPOLine.update({
      where: { id: lineId },
      data: {
        consumedQty: new Prisma.Decimal(consumed),
        remainingQty: new Prisma.Decimal(remaining),
        consumedValue: new Prisma.Decimal(round2(consumed * unit)),
        remainingValue: new Prisma.Decimal(round2(remaining * unit)),
      },
    });
    pool.push({ customerPOLineId: lineId, description: pl.description, ordered, consumed, remaining });
  }

  // Roll the header consumed/remaining value up from the lines.
  const consumedAgg = await prisma.customerPOLine.aggregate({
    where: { customerPOId: poId },
    _sum: { consumedValue: true },
  });
  const consumedValue = Number(consumedAgg._sum.consumedValue ?? 0);
  const totalValue = Number(po.totalValue ?? 0);
  await prisma.customerPO.update({
    where: { id: poId },
    data: {
      poConsumedValue: new Prisma.Decimal(round2(consumedValue)),
      poRemainingValue: new Prisma.Decimal(round2(totalValue - consumedValue)),
    },
  });

  const netValue = round2(
    lines.reduce((s, l) => {
      const pl = poLineById.get(l.customerPOLineId)!;
      const unit = l.unitPrice ?? Number(pl.agreedUnitPrice ?? 0);
      return s + Number(l.qty) * unit;
    }, 0)
  );

  return { ok: true, status: 201, callOffId: callOff.id, callOffNo: callOff.callOffNo, netValue, pool };
}

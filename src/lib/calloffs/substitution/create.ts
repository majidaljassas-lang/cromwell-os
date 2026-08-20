// Create a CallOffSubstitution batch: snapshot each requested line swap against a
// call-off (drawdown) CustomerPO. The parent ticket is NOT mutated here — that
// happens only on apply(). Batch starts DRAFT (or PENDING for immediate send).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export type SwapInput = {
  oldTicketLineId: string;
  newDescription: string;
  newCode?: string | null;
  newCanonicalProductId?: string | null;
  /** Defaults to the line's remaining (ordered − called-off). Capped at remaining. */
  qtyToSwap?: number;
  note?: string | null;
};

export type CreateSubstitutionInput = {
  customerPOId: string;
  /** Scope the batch to one call-off drawdown; null/undefined = PO-wide. */
  callOffId?: string | null;
  title: string;
  notes?: string | null;
  swaps: SwapInput[];
  initialState?: "DRAFT" | "PENDING_CUSTOMER_CONFIRMATION";
};

export type CreateSubstitutionResult = {
  ok: true;
  substitutionId: string;
  lineCount: number;
};

export async function createSubstitutionBatch(
  input: CreateSubstitutionInput,
): Promise<CreateSubstitutionResult> {
  if (!input.swaps.length) throw new Error("At least one swap is required");

  const po = await prisma.customerPO.findUnique({
    where: { id: input.customerPOId },
    include: {
      lines: {
        include: {
          ticketLine: { select: { id: true, description: true, productCode: true } },
        },
      },
    },
  });
  if (!po) throw new Error("PO not found");
  if (!po.ticketId) throw new Error("PO has no linked ticket — cannot substitute");

  const callOffId = input.callOffId || null;
  if (callOffId) {
    const co = await prisma.callOff.findUnique({
      where: { id: callOffId },
      select: { customerPOId: true },
    });
    if (!co || co.customerPOId !== po.id) {
      throw new Error("Call-off does not belong to this PO");
    }
  }

  const poLineByTL = new Map<string, (typeof po.lines)[number]>();
  for (const pl of po.lines) {
    if (pl.ticketLineId) poLineByTL.set(pl.ticketLineId, pl);
  }

  const tlIds = input.swaps.map((s) => s.oldTicketLineId);

  // Committed (frozen) per ticket line. PO-wide: every call-off's requested qty.
  // Scoped: only the target call-off's requested qty, and the swappable balance
  // is that draw's undelivered portion (requested − delivered-on-this-call-off).
  const calledOffAgg = await prisma.callOffLine.groupBy({
    by: ["ticketLineId"],
    where: callOffId
      ? { ticketLineId: { in: tlIds }, callOffId }
      : { ticketLineId: { in: tlIds }, callOff: { customerPOId: po.id } },
    _sum: { requestedQty: true },
  });
  const calledOffByTL = new Map<string, number>();
  for (const g of calledOffAgg) {
    if (g.ticketLineId) calledOffByTL.set(g.ticketLineId, Number(g._sum.requestedQty ?? 0));
  }

  const deliveredByTL = new Map<string, number>();
  if (callOffId) {
    const deliveredAgg = await prisma.deliveryNoteLine.groupBy({
      by: ["ticketLineId"],
      where: { ticketLineId: { in: tlIds }, deliveryNote: { callOffId } },
      _sum: { qtyDelivered: true },
    });
    for (const g of deliveredAgg) {
      if (g.ticketLineId) deliveredByTL.set(g.ticketLineId, Number(g._sum.qtyDelivered ?? 0));
    }
  }

  type Resolved = {
    oldTicketLineId: string;
    oldDescription: string;
    oldCode: string | null;
    newDescription: string;
    newCode: string | null;
    newCanonicalProductId: string | null;
    qtyToSwap: number;
    frozenQty: number;
    note: string | null;
  };
  const resolved: Resolved[] = [];

  for (const s of input.swaps) {
    const pl = poLineByTL.get(s.oldTicketLineId);
    if (!pl) throw new Error(`ticketLineId not on this PO: ${s.oldTicketLineId}`);
    if (!s.newDescription?.trim()) throw new Error("newDescription is required for every swap");

    const committed = calledOffByTL.get(s.oldTicketLineId) ?? 0;
    let remaining: number;
    // frozenQty = the qty that stays pinned to the old item when applied.
    let frozen: number;
    if (callOffId) {
      if (committed <= 0) {
        throw new Error(`Line "${pl.description}" is not drawn on this call-off`);
      }
      const delivered = deliveredByTL.get(s.oldTicketLineId) ?? 0;
      remaining = Math.max(0, committed - delivered);
      if (remaining <= 0) {
        throw new Error(
          `Line "${pl.description}" is fully delivered on this call-off — nothing to swap`,
        );
      }
      frozen = delivered;
    } else {
      const ordered = Number(pl.qty ?? 0);
      remaining = Math.max(0, ordered - committed);
      if (remaining <= 0) {
        throw new Error(
          `Line "${pl.description}" is fully called off — nothing left to swap`,
        );
      }
      frozen = committed;
    }
    const qty = s.qtyToSwap != null ? Number(s.qtyToSwap) : remaining;
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("qtyToSwap must be > 0");
    if (qty > remaining + 1e-6) {
      throw new Error(
        `qtyToSwap ${qty} exceeds remaining ${remaining} on line "${pl.description}"`,
      );
    }

    resolved.push({
      oldTicketLineId: s.oldTicketLineId,
      oldDescription: pl.ticketLine?.description ?? pl.description,
      oldCode: pl.ticketLine?.productCode ?? null,
      newDescription: s.newDescription.trim(),
      newCode: s.newCode?.trim() || null,
      newCanonicalProductId: s.newCanonicalProductId || null,
      qtyToSwap: qty,
      frozenQty: frozen,
      note: s.note?.trim() || null,
    });
  }

  const batch = await prisma.callOffSubstitution.create({
    data: {
      customerPOId: po.id,
      callOffId,
      title: input.title,
      notes: input.notes?.trim() || null,
      workflowState: input.initialState ?? "DRAFT",
      lines: {
        create: resolved.map((r, i) => ({
          oldTicketLineId: r.oldTicketLineId,
          oldDescription: r.oldDescription,
          oldCode: r.oldCode,
          newDescription: r.newDescription,
          newCode: r.newCode,
          newCanonicalProductId: r.newCanonicalProductId,
          qtyToSwap: new Prisma.Decimal(r.qtyToSwap),
          frozenQtySnapshot: new Prisma.Decimal(r.frozenQty),
          note: r.note,
          displayOrder: i + 1,
        })),
      },
    },
    select: { id: true, _count: { select: { lines: true } } },
  });

  return { ok: true, substitutionId: batch.id, lineCount: batch._count.lines };
}

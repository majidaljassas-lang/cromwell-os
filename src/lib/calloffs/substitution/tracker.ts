// Read model for the call-off PO substitution tracker.
//
// Per CustomerPO line it returns the draw-down balance ladder
// (ordered / called-off / delivered-locked / remaining) plus the swap chain so
// the screen can render "original → current" and a per-line swap history.
//
// "Called-off" is the committed figure that freezes on the old item when a line
// is swapped — it mirrors the remaining-qty rule in
// src/app/api/customer-pos/[id]/call-offs/route.ts (remaining = ordered − Σ
// requestedQty). "Delivered" is a subset of called-off, surfaced only so the UI
// can grey out what has physically shipped.

import { prisma } from "@/lib/prisma";

export type TrackerLine = {
  poLineId: string;
  ticketLineId: string | null;
  description: string;
  code: string | null;
  unit: string | null;
  ordered: number;
  calledOff: number;
  delivered: number;
  remaining: number;
  status: string | null;
  /** This line's ticket line was swapped out (superseded by a newer line). */
  superseded: boolean;
  /** If this line replaced another via a swap, the old item it replaced. */
  replaces: { description: string; code: string | null } | null;
};

export type TrackerBatch = {
  id: string;
  title: string;
  workflowState: string;
  lineCount: number;
  createdAt: Date;
  approvedAt: Date | null;
  appliedAt: Date | null;
  pdfFileName: string | null;
};

export type TrackerCallOff = {
  id: string;
  callOffNo: number;
  callOffDate: Date;
  status: string;
};

export type PoSubstitutionTracker = {
  po: {
    id: string;
    poNo: string;
    poType: string;
    status: string;
    poLimitValue: number | null;
    ticketId: string | null;
  };
  /** The call-off this view is scoped to, or null for the PO-wide view. */
  callOffId: string | null;
  /** All call-offs on this PO, for the scope selector. */
  callOffs: TrackerCallOff[];
  lines: TrackerLine[];
  batches: TrackerBatch[];
};

export async function getPoSubstitutionTracker(
  poId: string,
  callOffId?: string | null,
): Promise<PoSubstitutionTracker | null> {
  const po = await prisma.customerPO.findUnique({
    where: { id: poId },
    include: {
      lines: {
        include: {
          ticketLine: {
            select: {
              id: true,
              description: true,
              productCode: true,
              unit: true,
              status: true,
              substitutedFromLineId: true,
              substitutedToLines: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!po) return null;

  const ticketLineIds = po.lines
    .map((l) => l.ticketLineId)
    .filter((id): id is string => Boolean(id));

  // Called-off / delivered per ticket line. Scope narrows to a single call-off
  // when callOffId is set (swap-within-call-off): "called off" becomes that
  // call-off's requested qty and "delivered" its delivery-note qty, so the
  // swappable balance is exactly the undelivered portion of that one drawdown.
  const [calledOffAgg, deliveredAgg] = await Promise.all([
    ticketLineIds.length
      ? prisma.callOffLine.groupBy({
          by: ["ticketLineId"],
          where: callOffId
            ? { ticketLineId: { in: ticketLineIds }, callOffId }
            : { ticketLineId: { in: ticketLineIds }, callOff: { customerPOId: poId } },
          _sum: { requestedQty: true },
        })
      : Promise.resolve([]),
    ticketLineIds.length && po.ticketId
      ? prisma.deliveryNoteLine.groupBy({
          by: ["ticketLineId"],
          where: {
            ticketLineId: { in: ticketLineIds },
            deliveryNote: callOffId ? { callOffId } : { ticketId: po.ticketId },
          },
          _sum: { qtyDelivered: true },
        })
      : Promise.resolve([]),
  ]);

  const calledOffByTL = new Map<string, number>();
  for (const g of calledOffAgg) {
    if (g.ticketLineId) calledOffByTL.set(g.ticketLineId, Number(g._sum.requestedQty ?? 0));
  }
  const deliveredByTL = new Map<string, number>();
  for (const g of deliveredAgg) {
    if (g.ticketLineId) deliveredByTL.set(g.ticketLineId, Number(g._sum.qtyDelivered ?? 0));
  }

  // Resolve "replaces" — for a line whose ticket line came from a swap, look up
  // the old ticket line it superseded.
  const parentIds = po.lines
    .map((l) => l.ticketLine?.substitutedFromLineId)
    .filter((id): id is string => Boolean(id));
  const parents = parentIds.length
    ? await prisma.ticketLine.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, description: true, productCode: true },
      })
    : [];
  const parentById = new Map(parents.map((p) => [p.id, p]));

  const lines: TrackerLine[] = po.lines
    .map((l) => {
      const tl = l.ticketLine;
      const calledOff = tl ? (calledOffByTL.get(tl.id) ?? 0) : 0;
      const delivered = tl ? (deliveredByTL.get(tl.id) ?? 0) : 0;
      // Scoped view: "ordered" is what this one call-off drew; swappable is the
      // undelivered part of that draw. PO-wide view: ordered is the PO line qty.
      const ordered = callOffId ? calledOff : Number(l.qty ?? 0);
      const remaining = callOffId
        ? Math.max(0, calledOff - delivered)
        : Math.max(0, ordered - calledOff);
      const parent = tl?.substitutedFromLineId
        ? parentById.get(tl.substitutedFromLineId)
        : undefined;
      return {
        poLineId: l.id,
        ticketLineId: l.ticketLineId,
        description: l.description,
        code: tl?.productCode ?? null,
        unit: tl?.unit ?? null,
        ordered,
        calledOff,
        delivered,
        remaining,
        status: tl?.status ?? null,
        superseded: tl?.status === "SUPERSEDED" || (tl?.substitutedToLines.length ?? 0) > 0,
        replaces: parent
          ? { description: parent.description, code: parent.productCode }
          : null,
      };
    })
    // In scoped mode, only lines drawn on that call-off are relevant.
    .filter((l) => !callOffId || l.ordered > 0);

  const callOffRows = await prisma.callOff.findMany({
    where: { customerPOId: poId },
    orderBy: { callOffNo: "asc" },
    select: { id: true, callOffNo: true, callOffDate: true, status: true },
  });

  const batchRows = await prisma.callOffSubstitution.findMany({
    where: { customerPOId: poId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  const batches: TrackerBatch[] = batchRows.map((b) => ({
    id: b.id,
    title: b.title,
    workflowState: b.workflowState,
    lineCount: b._count.lines,
    createdAt: b.createdAt,
    approvedAt: b.approvedAt,
    appliedAt: b.appliedAt,
    pdfFileName: b.pdfFileName,
  }));

  return {
    po: {
      id: po.id,
      poNo: po.poNo,
      poType: po.poType,
      status: po.status,
      poLimitValue: po.poLimitValue ? Number(po.poLimitValue) : null,
      ticketId: po.ticketId,
    },
    callOffId: callOffId ?? null,
    callOffs: callOffRows,
    lines,
    batches,
  };
}

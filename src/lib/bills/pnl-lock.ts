/**
 * P&L actualisation — lock TicketLine margins when both sides of the deal
 * have settled.
 *
 * A TicketLine is eligible to lock when:
 *   • every SalesInvoiceLine tied to it belongs to a SalesInvoice with
 *     status = 'PAID' (settled), AND
 *   • every SupplierBill that funded a CostAllocation on this TicketLine
 *     has paymentStatus = 'PAID', AND
 *   • there are no UNRESOLVED BillLineAllocations still open against it.
 *
 * Locking writes actualCostTotal / actualSaleTotal / actualMarginTotal /
 * varianceTotal on the TicketLine, sets isLocked=true, and records a
 * MarginLockAudit row. A Ticket closes when all of its lines are locked.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export interface LockResult {
  ticketLineId: string;
  locked: boolean;
  reason: string;
  actualCostTotal?: number;
  actualSaleTotal?: number;
  actualMarginTotal?: number;
  varianceTotal?: number;
}

export interface SweepResult {
  scanned: number;
  locked: number;
  skipped: number;
  closedTickets: string[];
  details: LockResult[];
}

export async function tryLockTicketLine(ticketLineId: string): Promise<LockResult> {
  const tl = await prisma.ticketLine.findUnique({
    where: { id: ticketLineId },
    select: {
      id: true, ticketId: true, isLocked: true, expectedMarginTotal: true,
    },
  });
  if (!tl) return { ticketLineId, locked: false, reason: "ticket line not found" };
  if (tl.isLocked) return { ticketLineId, locked: false, reason: "already locked" };

  const [invoiceLines, costAllocations, openUnresolved] = await Promise.all([
    prisma.salesInvoiceLine.findMany({
      where: { ticketLineId },
      select: { lineTotal: true, salesInvoice: { select: { status: true } } },
    }),
    prisma.costAllocation.findMany({
      where: { ticketLineId },
      select: {
        totalCost: true,
        supplierBillLine: { select: { supplierBill: { select: { id: true, paymentStatus: true } } } },
      },
    }),
    prisma.billLineAllocation.count({
      where: { ticketLineId, allocationType: "UNRESOLVED" },
    }),
  ]);

  if (invoiceLines.length === 0) {
    return { ticketLineId, locked: false, reason: "no invoice lines yet" };
  }
  const allInvoicesPaid = invoiceLines.every((i) => i.salesInvoice?.status === "PAID");
  if (!allInvoicesPaid) {
    return { ticketLineId, locked: false, reason: "sales not fully settled" };
  }

  if (costAllocations.length === 0) {
    return { ticketLineId, locked: false, reason: "no cost allocations yet" };
  }
  const allBillsPaid = costAllocations.every(
    (c) => c.supplierBillLine?.supplierBill?.paymentStatus === "PAID",
  );
  if (!allBillsPaid) {
    return { ticketLineId, locked: false, reason: "supplier bills not fully paid" };
  }

  if (openUnresolved > 0) {
    return { ticketLineId, locked: false, reason: "unresolved bill allocations still open" };
  }

  const actualSaleTotal = round2(invoiceLines.reduce((s, l) => s + Number(l.lineTotal), 0));
  const actualCostTotal = round2(costAllocations.reduce((s, c) => s + Number(c.totalCost), 0));
  const actualMarginTotal = round2(actualSaleTotal - actualCostTotal);
  const expected = tl.expectedMarginTotal != null ? Number(tl.expectedMarginTotal) : null;
  const varianceTotal = expected != null ? round2(actualMarginTotal - expected) : null;

  const supplierBillIds = [...new Set(
    costAllocations
      .map((c) => c.supplierBillLine?.supplierBill?.id)
      .filter((v): v is string => !!v),
  )];
  const salesInvoiceIds = await prisma.salesInvoiceLine.findMany({
    where: { ticketLineId }, select: { salesInvoiceId: true },
  }).then((rows) => [...new Set(rows.map((r) => r.salesInvoiceId))]);

  await prisma.$transaction(async (tx) => {
    await tx.ticketLine.update({
      where: { id: ticketLineId },
      data: {
        actualCostTotal,
        actualSaleTotal,
        actualMarginTotal,
        varianceTotal: varianceTotal ?? undefined,
        isLocked: true,
        costStatus: "LOCKED",
        salesStatus: "LOCKED",
      },
    });
    await tx.marginLockAudit.create({
      data: {
        ticketId: tl.ticketId,
        ticketLineId: tl.id,
        actualCostTotal,
        actualSaleTotal,
        actualMarginTotal,
        varianceTotal: varianceTotal ?? undefined,
        reason: "Sales settled and supplier bills paid — P&L locked",
        supplierBillIds,
        salesInvoiceIds,
      },
    });
  });

  await logAudit({
    objectType: "TicketLine",
    objectId:   ticketLineId,
    actionType: "MARGIN_LOCKED",
    actor:      "SYSTEM",
    newValue:   { actualCostTotal, actualSaleTotal, actualMarginTotal, varianceTotal },
  });

  return { ticketLineId, locked: true, reason: "locked", actualCostTotal, actualSaleTotal, actualMarginTotal, varianceTotal: varianceTotal ?? undefined };
}

export async function sweepPnlLock(): Promise<SweepResult> {
  const candidates = await prisma.ticketLine.findMany({
    where: {
      isLocked: false,
      invoiceLines: { some: { salesInvoice: { status: "PAID" } } },
    },
    select: { id: true, ticketId: true },
    take: 500,
  });

  const result: SweepResult = {
    scanned: candidates.length,
    locked: 0,
    skipped: 0,
    closedTickets: [],
    details: [],
  };

  const touchedTickets = new Set<string>();
  for (const c of candidates) {
    const r = await tryLockTicketLine(c.id);
    result.details.push(r);
    if (r.locked) { result.locked += 1; touchedTickets.add(c.ticketId); }
    else result.skipped += 1;
  }

  for (const ticketId of touchedTickets) {
    const remaining = await prisma.ticketLine.count({
      where: { ticketId, isLocked: false },
    });
    if (remaining === 0) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data:  { isLocked: true, closedAt: new Date() },
      }).catch(() => { /* ticket may lack these fields in older environments */ });
      result.closedTickets.push(ticketId);
    }
  }

  return result;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

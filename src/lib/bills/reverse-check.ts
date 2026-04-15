/**
 * Reverse check — every invoice line must have a corresponding bill line
 * (or an explicit OVERHEAD absorption). Lines that don't get costUnconfirmed=true.
 *
 * "Corresponding" = the invoice line's TicketLine has at least one CostAllocation
 * OR at least one AbsorbedCostAllocation OR a BillLineAllocation of type
 * TICKET_LINE / OVERHEAD tied to it.
 *
 * Run nightly (or on SupplierBill post / SalesInvoice issue) to keep the
 * finance-level "cost unconfirmed" queue live.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export interface ReverseCheckResult {
  scanned: number;
  flagged: number;
  cleared: number;
  unconfirmedLineIds: string[];
}

export async function runReverseCheck(opts: { since?: Date } = {}): Promise<ReverseCheckResult> {
  const since = opts.since ?? new Date(Date.now() - 180 * 86_400_000);

  const invoiceLines = await prisma.salesInvoiceLine.findMany({
    where: { salesInvoice: { issuedAt: { gte: since } } },
    select: {
      id: true,
      ticketLineId: true,
      costUnconfirmed: true,
      salesInvoice: { select: { id: true, invoiceNo: true, status: true } },
    },
  });

  const result: ReverseCheckResult = {
    scanned: invoiceLines.length,
    flagged: 0,
    cleared: 0,
    unconfirmedLineIds: [],
  };

  for (const il of invoiceLines) {
    const hasCost = await hasCoveringCost(il.ticketLineId);
    const shouldFlag = !hasCost;

    if (shouldFlag && !il.costUnconfirmed) {
      await prisma.salesInvoiceLine.update({
        where: { id: il.id },
        data:  { costUnconfirmed: true },
      });
      await prisma.ticketLine.update({
        where: { id: il.ticketLineId },
        data:  { costStatus: "UNCONFIRMED" },
      }).catch(() => { /* ticketLine may be gone */ });
      result.flagged += 1;
      result.unconfirmedLineIds.push(il.id);
    } else if (!shouldFlag && il.costUnconfirmed) {
      await prisma.salesInvoiceLine.update({
        where: { id: il.id },
        data:  { costUnconfirmed: false },
      });
      result.cleared += 1;
    }

    if (shouldFlag) result.unconfirmedLineIds.push(il.id);
  }

  await logAudit({
    objectType: "SalesInvoiceLine",
    objectId:   "batch",
    actionType: "REVERSE_CHECK_COMPLETE",
    actor:      "SYSTEM",
    newValue:   { scanned: result.scanned, flagged: result.flagged, cleared: result.cleared, since },
  });

  return result;
}

async function hasCoveringCost(ticketLineId: string): Promise<boolean> {
  const [cost, absorbed, alloc] = await Promise.all([
    prisma.costAllocation.count({ where: { ticketLineId } }),
    prisma.absorbedCostAllocation.count({ where: { ticketLineId } }),
    prisma.billLineAllocation.count({
      where: {
        ticketLineId,
        allocationType: { in: ["TICKET_LINE", "OVERHEAD"] },
      },
    }),
  ]);
  return cost + absorbed + alloc > 0;
}

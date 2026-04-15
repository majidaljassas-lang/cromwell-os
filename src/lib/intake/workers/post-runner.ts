/**
 * Post runner — APPROVED → POSTED.
 *
 * Walks each BillLineAllocation produced by the allocation engine and writes the
 * corresponding downstream record:
 *   TICKET_LINE        → CostAllocation
 *   STOCK              → StockExcessRecord
 *   RETURNS_CANDIDATE  → Return / ReturnLine
 *   OVERHEAD           → AbsorbedCostAllocation
 *   UNRESOLVED         → no posting (stays as a BillLineAllocation row for review)
 *
 * Idempotent: checks BillLineAllocation.costAllocationId / returnId / stockExcessRecordId /
 * absorbedAllocationId before creating duplicates.
 */

import { prisma } from "@/lib/prisma";
import { markStatus, bumpRetry } from "../queue";
import { logAudit } from "@/lib/ingestion/audit";

export async function runPoster(docId: string): Promise<"POSTED" | "ERROR"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc || !doc.supplierBillId) return "ERROR";

  try {
    const bill = await prisma.supplierBill.findUnique({
      where: { id: doc.supplierBillId },
      include: { lines: { include: { billLineAllocations: true } } },
    });
    if (!bill) return "ERROR";

    for (const line of bill.lines) {
      for (const a of line.billLineAllocations) {
        if (a.allocationType === "TICKET_LINE" && a.ticketLineId && !a.costAllocationId) {
          const ca = await prisma.costAllocation.create({
            data: {
              ticketLineId:       a.ticketLineId,
              supplierBillLineId: line.id,
              supplierId:         bill.supplierId,
              qtyAllocated:       a.qtyAllocated,
              unitCost:           line.unitCost,
              totalCost:          a.costAllocated,
              allocationStatus:   "MATCHED",
              confidenceScore:    a.confidence ?? undefined,
              notes:              a.reason ?? "Bills Intake Engine",
            },
          });
          await prisma.billLineAllocation.update({ where: { id: a.id }, data: { costAllocationId: ca.id } });
        } else if (a.allocationType === "STOCK" && !a.stockExcessRecordId) {
          const se = await prisma.stockExcessRecord.create({
            data: {
              supplierBillLineId: line.id,
              ticketLineId:       a.ticketLineId ?? undefined,
              purchasedCost:      a.costAllocated,
              usedCost:           0,
              excessCost:         a.costAllocated,
              excessQty:          a.qtyAllocated,
              treatment:          "HOLD_FOR_REUSE",
              status:             "HOLDING",
              description:        a.reason ?? "Bills Intake surplus → stock",
            },
          });
          await prisma.billLineAllocation.update({ where: { id: a.id }, data: { stockExcessRecordId: se.id } });
        } else if (a.allocationType === "RETURNS_CANDIDATE" && !a.returnId) {
          // Need a ticket to anchor the Return — use any ticket on the line or skip
          const anchorTicketId = a.ticketId ?? line.ticketId;
          if (anchorTicketId) {
            const ret = await prisma.return.create({
              data: {
                ticketId:   anchorTicketId,
                supplierId: bill.supplierId,
                returnDate: new Date(),
                status:     "PROPOSED",
                notes:      a.reason ?? "Bills Intake surplus → return candidate",
              },
            });
            await prisma.billLineAllocation.update({ where: { id: a.id }, data: { returnId: ret.id } });
          }
        } else if (a.allocationType === "OVERHEAD" && !a.absorbedAllocationId) {
          const anchorTicketId = a.ticketId ?? line.ticketId;
          if (anchorTicketId) {
            const ab = await prisma.absorbedCostAllocation.create({
              data: {
                supplierBillLineId: line.id,
                ticketId:           anchorTicketId,
                ticketLineId:       a.ticketLineId ?? undefined,
                description:        a.reason ?? "Bills Intake overhead absorb",
                amount:             a.costAllocated,
                allocationBasis:    "SYSTEM",
              },
            });
            await prisma.billLineAllocation.update({ where: { id: a.id }, data: { absorbedAllocationId: ab.id } });
          }
        }
      }
    }

    await markStatus(docId, "POSTED", { errorMessage: null });
    await logAudit({
      objectType: "SupplierBill",
      objectId:   doc.supplierBillId,
      actionType: "BILLS_INTAKE_POSTED",
      actor:      "SYSTEM",
    });
    return "POSTED";
  } catch (e) {
    await bumpRetry(docId, e instanceof Error ? e.message : "poster failed");
    return "ERROR";
  }
}

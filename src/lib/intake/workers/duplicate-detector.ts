/**
 * Duplicate Detector
 *
 * Computes a checksum over (supplierName|billNo|total|date). Flags:
 *   DEFINITE — exact checksum match against an existing bill
 *   POSSIBLE — 2+ of { billNo, total, date } match an existing bill for the same supplier
 *
 * Does not delete or mutate the duplicate; just tags it so the match engine
 * refuses to AUTO-post and routes to REVIEW_REQUIRED.
 */

import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export function computeBillChecksum(input: {
  supplierName: string | null;
  billNo: string | null;
  total: number | null;
  date: string | Date | null;
}) {
  const supp = (input.supplierName || "").trim().toUpperCase().replace(/\s+/g, " ");
  const bill = (input.billNo || "").trim().toUpperCase();
  const tot  = input.total != null ? Number(input.total).toFixed(2) : "";
  const d    = input.date ? new Date(input.date).toISOString().slice(0, 10) : "";
  return crypto.createHash("sha256").update(`${supp}|${bill}|${tot}|${d}`).digest("hex");
}

export type DuplicateVerdict =
  | { status: "DEFINITE"; ofBillId: string }
  | { status: "POSSIBLE"; ofBillId: string }
  | { status: null };

export async function detectDuplicate(billId: string): Promise<DuplicateVerdict> {
  const bill = await prisma.supplierBill.findUnique({
    where: { id: billId },
    include: { supplier: { select: { name: true } } },
  });
  if (!bill) return { status: null };

  const checksum = computeBillChecksum({
    supplierName: bill.supplier?.name ?? null,
    billNo:       bill.billNo,
    total:        Number(bill.totalCost),
    date:         bill.billDate,
  });

  // Always persist the checksum so future imports can match against it
  if (bill.checksum !== checksum) {
    await prisma.supplierBill.update({ where: { id: billId }, data: { checksum } });
  }

  // DEFINITE: exact checksum match on a different bill
  const exact = await prisma.supplierBill.findFirst({
    where: { checksum, id: { not: billId } },
    select: { id: true },
  });
  if (exact) {
    await prisma.supplierBill.update({
      where: { id: billId },
      data:  { duplicateOfBillId: exact.id, duplicateStatus: "DEFINITE" },
    });
    await logAudit({
      objectType: "SupplierBill",
      objectId:   billId,
      actionType: "DUPLICATE_DETECTED",
      actor:      "SYSTEM",
      newValue:   { duplicateStatus: "DEFINITE", ofBillId: exact.id, checksum },
    });
    return { status: "DEFINITE", ofBillId: exact.id };
  }

  // POSSIBLE: 2+ of { billNo, total, date } match an existing bill from same supplier
  const candidates = await prisma.supplierBill.findMany({
    where: {
      supplierId: bill.supplierId,
      id: { not: billId },
      OR: [
        { billNo:    bill.billNo },
        { billDate:  bill.billDate },
        { totalCost: bill.totalCost },
      ],
    },
    select: { id: true, billNo: true, totalCost: true, billDate: true },
    take: 20,
  });

  for (const c of candidates) {
    let hits = 0;
    if (c.billNo && c.billNo === bill.billNo) hits++;
    if (Number(c.totalCost) === Number(bill.totalCost)) hits++;
    if (c.billDate && new Date(c.billDate).toISOString().slice(0, 10) === new Date(bill.billDate).toISOString().slice(0, 10)) hits++;
    if (hits >= 2) {
      await prisma.supplierBill.update({
        where: { id: billId },
        data:  { duplicateOfBillId: c.id, duplicateStatus: "POSSIBLE" },
      });
      await logAudit({
        objectType: "SupplierBill",
        objectId:   billId,
        actionType: "DUPLICATE_DETECTED",
        actor:      "SYSTEM",
        newValue:   { duplicateStatus: "POSSIBLE", ofBillId: c.id, hits },
      });
      return { status: "POSSIBLE", ofBillId: c.id };
    }
  }

  return { status: null };
}

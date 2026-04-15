/**
 * AP ledger — aged view of SupplierBills with paymentStatus != PAID.
 *
 * Buckets relative to today:
 *   overdue      — dueDate < today
 *   dueThisWeek  — today ≤ dueDate < today + 7 days
 *   upcoming     — dueDate ≥ today + 7 days
 *   noDueDate    — dueDate null (data gap; surface so it doesn't hide)
 */

import { prisma } from "@/lib/prisma";

export interface AgedBucket {
  label: "overdue" | "dueThisWeek" | "upcoming" | "noDueDate";
  count: number;
  totalIncVat: number;
  bills: AgedBill[];
}

export interface AgedBill {
  id: string;
  supplierId: string;
  supplierName: string;
  billNo: string;
  billDate: string;
  dueDate: string | null;
  amountIncVat: number;
  paymentStatus: string;
  ageDays: number | null;
}

export interface ApLedgerView {
  asOf: string;
  totals: { unpaidCount: number; unpaidAmount: number };
  overdue:     AgedBucket;
  dueThisWeek: AgedBucket;
  upcoming:    AgedBucket;
  noDueDate:   AgedBucket;
}

export async function getApLedger(asOf: Date = new Date()): Promise<ApLedgerView> {
  const startOfToday = startOfDay(asOf);
  const weekOut = new Date(startOfToday.getTime() + 7 * 86_400_000);

  const rows = await prisma.supplierBill.findMany({
    where: {
      paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
      status:        { not: "VOID" },
    },
    select: {
      id: true, supplierId: true, billNo: true, billDate: true, dueDate: true,
      amountIncVat: true, totalCost: true, paymentStatus: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }, { billDate: "asc" }],
  });

  const view: ApLedgerView = {
    asOf: startOfToday.toISOString().slice(0, 10),
    totals: { unpaidCount: rows.length, unpaidAmount: 0 },
    overdue:     emptyBucket("overdue"),
    dueThisWeek: emptyBucket("dueThisWeek"),
    upcoming:    emptyBucket("upcoming"),
    noDueDate:   emptyBucket("noDueDate"),
  };

  for (const r of rows) {
    const amount = Number(r.amountIncVat ?? r.totalCost ?? 0);
    view.totals.unpaidAmount += amount;

    const bill: AgedBill = {
      id: r.id,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      billNo: r.billNo,
      billDate: r.billDate.toISOString().slice(0, 10),
      dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
      amountIncVat: round2(amount),
      paymentStatus: r.paymentStatus,
      ageDays: r.dueDate
        ? Math.floor((startOfToday.getTime() - startOfDay(r.dueDate).getTime()) / 86_400_000)
        : null,
    };

    const bucket: AgedBucket =
      r.dueDate == null                            ? view.noDueDate   :
      r.dueDate <  startOfToday                    ? view.overdue     :
      r.dueDate <  weekOut                         ? view.dueThisWeek :
                                                     view.upcoming;

    bucket.count += 1;
    bucket.totalIncVat = round2(bucket.totalIncVat + amount);
    bucket.bills.push(bill);
  }

  view.totals.unpaidAmount = round2(view.totals.unpaidAmount);
  return view;
}

function emptyBucket(label: AgedBucket["label"]): AgedBucket {
  return { label, count: 0, totalIncVat: 0, bills: [] };
}
function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

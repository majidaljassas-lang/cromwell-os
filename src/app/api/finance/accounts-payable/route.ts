/**
 * GET /api/finance/accounts-payable
 *
 * The AP register: open supplier bills (post-cutover) grouped into aging buckets,
 * with per-supplier balance summaries and a flat list of unpaid bills.
 *
 * Returns:
 *   - aging:     { current, days30, days60, days90, total } (£ totals)
 *   - suppliers: per-supplier balances + bill count + oldest bill age
 *   - openBills: flat list of unpaid bills (already sorted by bill date asc)
 */
import { prisma } from "@/lib/prisma";

const CUTOVER = new Date("2026-04-01");

export async function GET() {
  const today = new Date();

  // Pull every post-cutover bill with its payments
  const bills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: CUTOVER } },
    include: {
      supplier: { select: { id: true, name: true } },
      paymentAllocations: { select: { amount: true } },
    },
    orderBy: { billDate: "asc" },
  });

  type BillRow = {
    id: string;
    billNo: string;
    billDate: string;
    supplierId: string;
    supplierName: string;
    totalCost: number;
    paid: number;
    outstanding: number;
    ageDays: number;
    bucket: "current" | "days30" | "days60" | "days90";
  };

  const open: BillRow[] = [];
  const aging = { current: 0, days30: 0, days60: 0, days90: 0, total: 0 };
  type SupBal = { supplierId: string; supplierName: string; outstanding: number; bills: number; oldestDays: number };
  const supplierMap = new Map<string, SupBal>();

  for (const b of bills) {
    const total = Number(b.totalCost);
    const paid  = b.paymentAllocations.reduce((s, a) => s + Number(a.amount), 0);
    const outstanding = +(total - paid).toFixed(2);
    if (outstanding <= 0.005) continue; // fully paid

    const ageDays = Math.max(0, Math.floor((today.getTime() - new Date(b.billDate).getTime()) / 86_400_000));
    const bucket: BillRow["bucket"] =
      ageDays <= 30 ? "current" :
      ageDays <= 60 ? "days30"  :
      ageDays <= 90 ? "days60"  : "days90";

    aging[bucket] += outstanding;
    aging.total   += outstanding;

    open.push({
      id: b.id,
      billNo: b.billNo,
      billDate: b.billDate.toISOString(),
      supplierId: b.supplier.id,
      supplierName: b.supplier.name,
      totalCost: total,
      paid,
      outstanding,
      ageDays,
      bucket,
    });

    const cur = supplierMap.get(b.supplier.id) ?? { supplierId: b.supplier.id, supplierName: b.supplier.name, outstanding: 0, bills: 0, oldestDays: 0 };
    cur.outstanding += outstanding;
    cur.bills += 1;
    if (ageDays > cur.oldestDays) cur.oldestDays = ageDays;
    supplierMap.set(b.supplier.id, cur);
  }

  const suppliers = [...supplierMap.values()].sort((a, b) => b.outstanding - a.outstanding);
  // Round aging totals
  (Object.keys(aging) as Array<keyof typeof aging>).forEach((k) => { aging[k] = +aging[k].toFixed(2); });

  return Response.json({
    asOf: today.toISOString(),
    cutover: CUTOVER.toISOString(),
    aging,
    suppliers,
    openBills: open,
  });
}

/**
 * GET  /api/finance/payments-made           — list recent supplier payments
 * POST /api/finance/payments-made           — record a payment + allocate it across bills
 *
 * Body (POST):
 *   {
 *     supplierId: string;
 *     paymentDate?: string (ISO);   // defaults today
 *     paymentMethod?: string;
 *     reference?: string;
 *     bankAccountId?: string;
 *     allocations: Array<{ supplierBillId: string; amount: number }>;
 *   }
 *
 * Side effects:
 *   - creates PaymentMade
 *   - creates one PaymentMadeAllocation per bill
 *   - updates SupplierBill.status to "paid" or "partially_paid" based on remaining balance
 */
import { prisma } from "@/lib/prisma";

export async function GET() {
  const payments = await prisma.paymentMade.findMany({
    take: 50,
    orderBy: { paymentDate: "desc" },
    include: {
      supplier: { select: { id: true, name: true } },
      allocations: {
        include: { supplierBill: { select: { id: true, billNo: true, totalCost: true } } },
      },
    },
  });
  return Response.json({ payments });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      supplierId?: string;
      paymentDate?: string;
      paymentMethod?: string;
      reference?: string;
      bankAccountId?: string;
      allocations?: Array<{ supplierBillId: string; amount: number }>;
    };
    const supplierId = body.supplierId;
    const allocations = body.allocations ?? [];
    if (!supplierId || allocations.length === 0) {
      return Response.json({ error: "supplierId + allocations[] required" }, { status: 400 });
    }
    const total = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
    if (total <= 0) return Response.json({ error: "total amount must be > 0" }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const pm = await tx.paymentMade.create({
        data: {
          supplierId,
          paymentDate:   body.paymentDate ? new Date(body.paymentDate) : new Date(),
          amount:        total,
          paymentMethod: body.paymentMethod ?? null,
          reference:     body.reference ?? null,
          bankAccountId: body.bankAccountId ?? null,
        },
      });
      for (const a of allocations) {
        const billId = a.supplierBillId;
        const amt    = Number(a.amount);
        if (!billId || amt <= 0) continue;
        await tx.paymentMadeAllocation.create({
          data: { paymentMadeId: pm.id, supplierBillId: billId, amount: amt },
        });
        // Recompute paid + status on the bill
        const bill = await tx.supplierBill.findUnique({
          where: { id: billId },
          include: { paymentAllocations: { select: { amount: true } } },
        });
        if (!bill) continue;
        const paid = bill.paymentAllocations.reduce((s, x) => s + Number(x.amount), 0);
        const totalCost = Number(bill.totalCost);
        const status = paid + 0.005 >= totalCost ? "paid" : paid > 0 ? "partially_paid" : bill.status;
        await tx.supplierBill.update({ where: { id: billId }, data: { status } });
      }
      return pm;
    });

    return Response.json({ ok: true, paymentMadeId: result.id, total });
  } catch (e) {
    console.error("/api/finance/payments-made POST failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

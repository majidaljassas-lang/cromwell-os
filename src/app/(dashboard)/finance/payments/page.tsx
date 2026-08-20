import { prisma } from "@/lib/prisma";
import { PaymentsPanel } from "./PaymentsPanel";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function PaymentsPage() {
  const [received, made, openInvoices, openBills, suppliers] = await Promise.all([
    prisma.payment.findMany({
      orderBy: { paymentDate: "desc" },
      take: 50,
      include: {
        salesInvoice: {
          select: { invoiceNo: true, customer: { select: { name: true } } },
        },
      },
    }),
    prisma.paymentMade.findMany({
      orderBy: { paymentDate: "desc" },
      take: 50,
      include: {
        supplier: { select: { name: true } },
        allocations: {
          include: { supplierBill: { select: { billNo: true } } },
        },
      },
    }),
    prisma.salesInvoice.findMany({
      where: { status: { in: ["SENT", "OVERDUE", "PARTIAL"] } },
      orderBy: { dueDate: "asc" },
      take: 200,
      include: {
        customer: { select: { name: true } },
        payments: { select: { amount: true } },
      },
    }),
    prisma.supplierBill.findMany({
      where: { status: { notIn: ["PAID", "VOID", "CANCELLED"] } },
      orderBy: { dueDate: "asc" },
      take: 200,
      include: {
        supplier: { select: { id: true, name: true } },
        paymentAllocations: { select: { amount: true } },
      },
    }),
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 1000,
    }),
  ]);

  const invoiceOptions = openInvoices.map((inv) => {
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Number(inv.totalSell) - paid;
    return {
      id: inv.id,
      label: `${inv.invoiceNo ?? "(no #)"} — ${inv.customer.name}`,
      total: Number(inv.totalSell),
      outstanding,
    };
  }).filter((i) => i.outstanding > 0.005);

  const billOptions = openBills.map((b) => {
    const paid = b.paymentAllocations.reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = Number(b.totalCost) - paid;
    return {
      id: b.id,
      supplierId: b.supplierId,
      label: `${b.billNo ?? "(no #)"} — ${b.supplier.name}`,
      total: Number(b.totalCost),
      outstanding,
    };
  }).filter((b) => b.outstanding > 0.005);

  const totalReceived = received.reduce((s, p) => s + Number(p.amount), 0);
  const totalMade = made.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          PAYMENTS
        </h1>
        <div className="text-[10px] text-[#888888] uppercase tracking-widest">
          {received.length} in · {made.length} out · last 50 each
        </div>
      </div>

      <div className="text-[11px] text-[#888888] border border-[#333333] bg-[#1A1A1A] p-3">
        <div>
          Manual payment entry. Once the bank feed goes live the{" "}
          <a href="/finance/bank-inbox" className="text-[#FF6600] underline">
            Bank Inbox
          </a>{" "}
          will auto-suggest matches; this page stays as the manual fallback.
        </div>
      </div>

      <PaymentsPanel
        invoices={invoiceOptions}
        bills={billOptions}
        suppliers={suppliers}
      />

      {/* Received */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333] flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#00CC66] font-bold">
            RECEIVED FROM CUSTOMERS
          </span>
          <span className="text-[10px] tabular-nums text-[#888888]">
            £{fmt(totalReceived)} (last 50)
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-3 py-2 font-semibold">Invoice</th>
              <th className="text-left px-3 py-2 font-semibold">Customer</th>
              <th className="text-left px-3 py-2 font-semibold w-32">Method</th>
              <th className="text-left px-3 py-2 font-semibold">Reference</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {received.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  — no receipts yet —
                </td>
              </tr>
            )}
            {received.map((p) => (
              <tr key={p.id} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-3 py-2 text-xs text-[#888888] tabular-nums">
                  {p.paymentDate.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-xs text-[#FF6600] font-mono">
                  {p.salesInvoice.invoiceNo ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-[#E0E0E0]">
                  {p.salesInvoice.customer.name}
                </td>
                <td className="px-3 py-2 text-[10px] text-[#888888]">{p.paymentMethod ?? "—"}</td>
                <td className="px-3 py-2 text-[10px] text-[#888888]">{p.reference ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#00CC66] font-bold">
                  £{fmt(Number(p.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Made */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333] flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-widest text-[#FF3333] font-bold">
            PAID TO SUPPLIERS
          </span>
          <span className="text-[10px] tabular-nums text-[#888888]">
            £{fmt(totalMade)} (last 50)
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-3 py-2 font-semibold">Supplier</th>
              <th className="text-left px-3 py-2 font-semibold">Allocated to bills</th>
              <th className="text-left px-3 py-2 font-semibold w-32">Method</th>
              <th className="text-left px-3 py-2 font-semibold">Reference</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Amount</th>
            </tr>
          </thead>
          <tbody>
            {made.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  — no supplier payments yet —
                </td>
              </tr>
            )}
            {made.map((p) => (
              <tr key={p.id} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-3 py-2 text-xs text-[#888888] tabular-nums">
                  {p.paymentDate.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-xs text-[#E0E0E0]">{p.supplier.name}</td>
                <td className="px-3 py-2 text-[10px] text-[#888888]">
                  {p.allocations
                    .map((a) => a.supplierBill.billNo ?? "(no #)")
                    .join(", ") || "—"}
                </td>
                <td className="px-3 py-2 text-[10px] text-[#888888]">{p.paymentMethod ?? "—"}</td>
                <td className="px-3 py-2 text-[10px] text-[#888888]">{p.reference ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#FF3333] font-bold">
                  £{fmt(Number(p.amount))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

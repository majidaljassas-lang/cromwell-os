import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bucketFor(daysOverdue: number): "CURRENT" | "D30" | "D60" | "D90PLUS" {
  if (daysOverdue <= 0) return "CURRENT";
  if (daysOverdue <= 30) return "D30";
  if (daysOverdue <= 60) return "D60";
  return "D90PLUS";
}

export default async function AgedDebtorsPage() {
  const today = new Date();

  const invoices = await prisma.salesInvoice.findMany({
    where: { status: { in: ["SENT", "OVERDUE", "PARTIAL"] } },
    include: {
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
      payments: { select: { amount: true } },
    },
    orderBy: { dueDate: "asc" },
  });

  type Row = {
    invoiceId: string;
    invoiceNo: string | null;
    customerId: string;
    customerName: string;
    siteName: string | null;
    issuedAt: string | null;
    dueDate: string | null;
    total: number;
    paid: number;
    outstanding: number;
    daysOverdue: number;
    bucket: "CURRENT" | "D30" | "D60" | "D90PLUS";
  };

  const rows: Row[] = invoices.map((inv) => {
    const total = Number(inv.totalSell);
    const paid = inv.payments.reduce((s, p) => s + Number(p.amount), 0);
    const outstanding = total - paid;
    let daysOverdue = 0;
    if (inv.dueDate) {
      daysOverdue = Math.floor((today.getTime() - inv.dueDate.getTime()) / 86400000);
    }
    return {
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      customerId: inv.customerId,
      customerName: inv.customer.name,
      siteName: inv.site?.siteName ?? null,
      issuedAt: inv.issuedAt?.toISOString().slice(0, 10) ?? null,
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      total,
      paid,
      outstanding,
      daysOverdue,
      bucket: bucketFor(daysOverdue),
    };
  });

  const open = rows.filter((r) => r.outstanding > 0.005);

  // Summary by customer
  const byCustomer = new Map<string, { name: string; current: number; d30: number; d60: number; d90: number; total: number }>();
  for (const r of open) {
    const ex = byCustomer.get(r.customerId) ?? {
      name: r.customerName,
      current: 0,
      d30: 0,
      d60: 0,
      d90: 0,
      total: 0,
    };
    if (r.bucket === "CURRENT") ex.current += r.outstanding;
    else if (r.bucket === "D30") ex.d30 += r.outstanding;
    else if (r.bucket === "D60") ex.d60 += r.outstanding;
    else ex.d90 += r.outstanding;
    ex.total += r.outstanding;
    byCustomer.set(r.customerId, ex);
  }
  const customerSummary = Array.from(byCustomer.entries())
    .map(([id, v]) => ({ customerId: id, ...v }))
    .sort((a, b) => b.total - a.total);

  const totals = customerSummary.reduce(
    (s, r) => ({
      current: s.current + r.current,
      d30: s.d30 + r.d30,
      d60: s.d60 + r.d60,
      d90: s.d90 + r.d90,
      total: s.total + r.total,
    }),
    { current: 0, d30: 0, d60: 0, d90: 0, total: 0 }
  );

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          AGED DEBTORS
        </h1>
      </div>

      {/* Buckets summary */}
      <div className="grid grid-cols-5 gap-3">
        <Bucket label="CURRENT" value={totals.current} accent="#00CC66" />
        <Bucket label="1–30" value={totals.d30} accent="#FFCC00" />
        <Bucket label="31–60" value={totals.d60} accent="#FF9900" />
        <Bucket label="60+" value={totals.d90} accent="#FF3333" />
        <Bucket label="TOTAL" value={totals.total} accent="#FF6600" />
      </div>

      {/* By customer */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333]">
          <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
            BY CUSTOMER
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-4 py-2 font-semibold">Customer</th>
              <th className="text-right px-4 py-2 font-semibold">Current</th>
              <th className="text-right px-4 py-2 font-semibold">1–30</th>
              <th className="text-right px-4 py-2 font-semibold">31–60</th>
              <th className="text-right px-4 py-2 font-semibold">60+</th>
              <th className="text-right px-4 py-2 font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {customerSummary.map((c) => (
              <tr key={c.customerId} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-4 py-2 text-xs text-[#E0E0E0]">{c.name}</td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  £{fmt(c.current)}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#FFCC00]">
                  £{fmt(c.d30)}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#FF9900]">
                  £{fmt(c.d60)}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#FF3333]">
                  £{fmt(c.d90)}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#FF6600] font-bold">
                  £{fmt(c.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333]">
          <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
            INVOICES ({open.length})
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-4 py-2 font-semibold w-24">Invoice</th>
              <th className="text-left px-4 py-2 font-semibold">Customer / Site</th>
              <th className="text-left px-4 py-2 font-semibold w-24">Issued</th>
              <th className="text-left px-4 py-2 font-semibold w-24">Due</th>
              <th className="text-right px-4 py-2 font-semibold w-20">Days</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Total</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {open.map((r) => (
              <tr key={r.invoiceId} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-4 py-2 text-xs text-[#FF6600] font-mono">
                  {r.invoiceNo ?? r.invoiceId.slice(0, 8)}
                </td>
                <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                  {r.customerName}
                  {r.siteName && (
                    <span className="text-[10px] text-[#888888]"> · {r.siteName}</span>
                  )}
                </td>
                <td className="px-4 py-2 text-[10px] tabular-nums text-[#888888]">
                  {r.issuedAt ?? "—"}
                </td>
                <td className="px-4 py-2 text-[10px] tabular-nums text-[#888888]">
                  {r.dueDate ?? "—"}
                </td>
                <td
                  className={`px-4 py-2 text-xs text-right tabular-nums font-bold ${
                    r.daysOverdue > 60
                      ? "text-[#FF3333]"
                      : r.daysOverdue > 30
                      ? "text-[#FF9900]"
                      : r.daysOverdue > 0
                      ? "text-[#FFCC00]"
                      : "text-[#00CC66]"
                  }`}
                >
                  {r.daysOverdue > 0 ? `+${r.daysOverdue}` : r.daysOverdue}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#888888]">
                  £{fmt(r.total)}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0] font-bold">
                  £{fmt(r.outstanding)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Bucket({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="border border-[#333333] bg-[#1A1A1A] p-3">
      <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: accent }}>
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums text-[#E0E0E0] mt-1">
        £{fmt(value)}
      </div>
    </div>
  );
}

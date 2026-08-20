import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function PaperPnlPage() {
  const entries = await prisma.paperLedgerEntry.findMany({
    orderBy: { entryDate: "desc" },
    take: 200,
    include: { customer: true, site: true, supplier: true },
  });

  const totalCost = entries.reduce((s, e) => s + Number(e.actualCostTotal), 0);
  const totalPaperSale = entries.reduce((s, e) => s + Number(e.paperSaleTotal), 0);
  const totalPaperMargin = entries.reduce((s, e) => s + Number(e.paperMarginTotal), 0);

  // Rollup by customer — who we're carrying, and how much.
  const byCustomer = new Map<string, { name: string; cost: number; sale: number; margin: number; n: number }>();
  for (const e of entries) {
    const key = e.customerId;
    const row = byCustomer.get(key) ?? {
      name: e.customer.name,
      cost: 0,
      sale: 0,
      margin: 0,
      n: 0,
    };
    row.cost += Number(e.actualCostTotal);
    row.sale += Number(e.paperSaleTotal);
    row.margin += Number(e.paperMarginTotal);
    row.n += 1;
    byCustomer.set(key, row);
  }
  const customerRows = [...byCustomer.values()].sort((a, b) => b.cost - a.cost);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          PAPER P&amp;L
        </h1>
        <Link
          href="/finance/paper-pnl/new"
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold"
        >
          + New
        </Link>
      </div>

      <p className="text-[11px] text-[#666666] max-w-3xl">
        Materials bought and given to customers without charge. The cost is real and already in the
        accounts. The sale is paper — the agreed rate it would have been billed at. Nothing here posts
        to the GL or becomes an invoice.
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">Real cost out</div>
          <div className="text-lg tabular-nums text-[#FF3333] mt-1">£{fmt(totalCost)}</div>
          <div className="text-[10px] text-[#666666] mt-1">Actually spent</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">Paper sale</div>
          <div className="text-lg tabular-nums text-[#888888] mt-1">£{fmt(totalPaperSale)}</div>
          <div className="text-[10px] text-[#666666] mt-1">Never invoiced — not turnover</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">Paper margin</div>
          <div className="text-lg tabular-nums text-[#FF6600] mt-1">£{fmt(totalPaperMargin)}</div>
          <div className="text-[10px] text-[#666666] mt-1">Given up by not charging</div>
        </div>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="border-b border-[#333333] px-3 py-2 text-[10px] uppercase tracking-widest text-[#888888]">
          By customer
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold">Customer</th>
              <th className="text-right px-3 py-2 font-semibold w-20">Entries</th>
              <th className="text-right px-3 py-2 font-semibold w-32">Real cost</th>
              <th className="text-right px-3 py-2 font-semibold w-32">Paper sale</th>
              <th className="text-right px-3 py-2 font-semibold w-32">Paper margin</th>
            </tr>
          </thead>
          <tbody>
            {customerRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {customerRows.map((r) => (
              <tr key={r.name} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-3 py-2 text-xs text-[#E0E0E0]">{r.name}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">{r.n}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#FF3333]">£{fmt(r.cost)}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">£{fmt(r.sale)}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#FF6600]">£{fmt(r.margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="border-b border-[#333333] px-3 py-2 text-[10px] uppercase tracking-widest text-[#888888]">
          Entries
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-3 py-2 font-semibold">Description</th>
              <th className="text-left px-3 py-2 font-semibold w-40">Customer</th>
              <th className="text-left px-3 py-2 font-semibold w-32">Site</th>
              <th className="text-right px-3 py-2 font-semibold w-20">Qty</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Real cost</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Paper sale</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Paper margin</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-3 py-2 text-xs tabular-nums text-[#888888]">
                  {e.entryDate.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-xs text-[#E0E0E0]">{e.description}</td>
                <td className="px-3 py-2 text-xs text-[#888888]">{e.customer.name}</td>
                <td className="px-3 py-2 text-xs text-[#888888]">{e.site?.siteName ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                  {Number(e.qty)} {e.unit}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#FF3333]">
                  £{fmt(Number(e.actualCostTotal))}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                  £{fmt(Number(e.paperSaleTotal))}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#FF6600]">
                  £{fmt(Number(e.paperMarginTotal))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

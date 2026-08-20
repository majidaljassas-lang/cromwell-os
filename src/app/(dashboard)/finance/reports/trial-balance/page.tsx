import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ asAt?: string }>;
}) {
  const params = await searchParams;
  const asAt = params.asAt ? new Date(`${params.asAt}T23:59:59.999Z`) : new Date();

  const grouped = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: {
      journalEntry: {
        entryDate: { lte: asAt },
        status: "POSTED",
      },
    },
    _sum: { debit: true, credit: true },
  });

  const accounts = await prisma.chartOfAccount.findMany({
    where: { id: { in: grouped.map((g) => g.accountId) } },
    orderBy: { accountCode: "asc" },
  });
  const sumsById = new Map(grouped.map((g) => [g.accountId, g]));

  const rows = accounts.map((a) => {
    const s = sumsById.get(a.id);
    const debit = Number(s?._sum.debit ?? 0);
    const credit = Number(s?._sum.credit ?? 0);
    const balance = debit - credit;
    return {
      accountId: a.id,
      code: a.accountCode,
      name: a.accountName,
      type: a.accountType,
      debit,
      credit,
      balance,
    };
  });

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  const drift = Math.abs(totalDebit - totalCredit);

  const asAtStr = asAt.toISOString().slice(0, 10);
  const drillUrl = (accountId: string) =>
    `/finance/reports/general-ledger?accountId=${accountId}&to=${asAtStr}`;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          TRIAL BALANCE
        </h1>
        <div className="text-[11px] text-[#888888] uppercase tracking-widest">
          AS AT {asAtStr}
        </div>
      </div>

      <form method="get" className="flex gap-2 items-end text-[11px]">
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">As at</span>
          <input
            type="date"
            name="asAt"
            defaultValue={asAtStr}
            className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold"
        >
          Apply
        </button>
      </form>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-4 py-2 font-semibold w-20">Code</th>
              <th className="text-left px-4 py-2 font-semibold">Account</th>
              <th className="text-left px-4 py-2 font-semibold w-24">Type</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Debit</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Credit</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.accountId} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-4 py-2 text-xs text-[#FF6600] font-mono">{r.code}</td>
                <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                  <Link href={drillUrl(r.accountId)} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-[10px] text-[#888888]">{r.type}</td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  {r.debit > 0 ? `£${fmt(r.debit)}` : "—"}
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  {r.credit > 0 ? `£${fmt(r.credit)}` : "—"}
                </td>
                <td
                  className={`px-4 py-2 text-xs text-right tabular-nums font-bold ${
                    r.balance >= 0 ? "text-[#E0E0E0]" : "text-[#FF6600]"
                  }`}
                >
                  £{fmt(r.balance)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#FF6600] bg-[#1F1F1F] font-bold">
              <td colSpan={3} className="px-4 py-3 text-[10px] uppercase tracking-widest text-[#FF6600]">
                TOTALS
              </td>
              <td className="px-4 py-3 text-xs text-right tabular-nums text-[#E0E0E0]">
                £{fmt(totalDebit)}
              </td>
              <td className="px-4 py-3 text-xs text-right tabular-nums text-[#E0E0E0]">
                £{fmt(totalCredit)}
              </td>
              <td
                className={`px-4 py-3 text-xs text-right tabular-nums ${
                  drift < 0.01 ? "text-[#00CC66]" : "text-[#FF3333]"
                }`}
              >
                {drift < 0.01 ? "BALANCED" : `DRIFT £${fmt(drift)}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

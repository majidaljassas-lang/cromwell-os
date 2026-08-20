import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

// UK Corporation Tax — FY24 onwards.
//   Small profits rate (≤ £50,000):    19%
//   Main rate          (> £250,000):    25%
//   Marginal relief    (£50k–£250k):    standard fraction 3/200
// Liability = profit × 25% − (UPPER − profit) × 3/200, for profits in band.
const SMALL_PROFITS_LIMIT = 50_000;
const UPPER_LIMIT = 250_000;
const SMALL_RATE = 0.19;
const MAIN_RATE = 0.25;
const MARGINAL_FRACTION = 3 / 200;

function computeCT(profit: number): {
  band: "SMALL" | "MARGINAL" | "MAIN" | "LOSS";
  tax: number;
  effectiveRate: number;
} {
  if (profit <= 0) return { band: "LOSS", tax: 0, effectiveRate: 0 };
  if (profit <= SMALL_PROFITS_LIMIT) {
    const tax = profit * SMALL_RATE;
    return { band: "SMALL", tax, effectiveRate: tax / profit };
  }
  if (profit > UPPER_LIMIT) {
    const tax = profit * MAIN_RATE;
    return { band: "MAIN", tax, effectiveRate: tax / profit };
  }
  const tax = profit * MAIN_RATE - (UPPER_LIMIT - profit) * MARGINAL_FRACTION;
  return { band: "MARGINAL", tax, effectiveRate: tax / profit };
}

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Default FY: UK April–March. Pick the FY containing today.
function defaultFinancialYear(now = new Date()): { from: Date; to: Date; label: string } {
  const y = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    from: new Date(Date.UTC(y, 3, 1)),
    to: new Date(Date.UTC(y + 1, 2, 31, 23, 59, 59, 999)),
    label: `FY${String(y).slice(-2)}/${String(y + 1).slice(-2)} (1 Apr ${y} – 31 Mar ${y + 1})`,
  };
}

export default async function CTPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const fy = defaultFinancialYear();
  const from = params.from ? new Date(params.from) : fy.from;
  const to = params.to ? new Date(`${params.to}T23:59:59.999Z`) : fy.to;

  const grouped = await prisma.journalLine.groupBy({
    by: ["accountId"],
    where: { journalEntry: { entryDate: { gte: from, lte: to }, status: "POSTED" } },
    _sum: { debit: true, credit: true },
  });
  const accounts = await prisma.chartOfAccount.findMany({
    where: { id: { in: grouped.map((g) => g.accountId) } },
    select: { id: true, accountCode: true, accountName: true, accountType: true, accountSubType: true },
  });
  const acctById = new Map(accounts.map((a) => [a.id, a]));

  let totalRevenue = 0;
  let totalCogs = 0;
  let totalOpex = 0;
  let totalDepreciation = 0;
  for (const g of grouped) {
    const a = acctById.get(g.accountId);
    if (!a) continue;
    const debit = Number(g._sum.debit ?? 0);
    const credit = Number(g._sum.credit ?? 0);
    if (a.accountType === "INCOME") totalRevenue += credit - debit;
    else if (a.accountType === "EXPENSE") {
      const net = debit - credit;
      if (a.accountSubType === "COST_OF_GOODS_SOLD") totalCogs += net;
      else totalOpex += net;
      // Depreciation is disallowable — the user can't reduce taxable profit
      // with it. Detect by name; the chart has no dedicated subtype.
      if (a.accountName.toLowerCase().includes("depreciation")) totalDepreciation += net;
    }
  }

  const grossProfit = totalRevenue - totalCogs;
  const accountingProfit = grossProfit - totalOpex;

  // Basic CT base = accounting profit + depreciation add-back. Real returns
  // also adjust for capital allowances, disallowables, losses b/f, etc — not
  // modelled here; surface the gap in the UI.
  const taxableProfit = accountingProfit + totalDepreciation;
  const result = computeCT(taxableProfit);

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          CORPORATION TAX
        </h1>
        <span className="text-[10px] tracking-widest text-[#888888] bb-mono">
          {fromStr} → {toStr}
        </span>
      </div>

      <div className="border border-[#FF9900] bg-[#1A1A1A] px-4 py-2 text-[10px] text-[#FFCC00] bb-mono">
        Estimate only. Real CT600 also requires capital allowances, disallowable expenses,
        R&amp;D claims, group relief and brought-forward losses — none modelled here.
        Depreciation is added back (shown below) but other adjustments are not.
      </div>

      <form method="get" className="flex gap-2 items-end">
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666] mb-1">From</span>
          <input
            type="date"
            name="from"
            defaultValue={fromStr}
            className="bg-[#0A0A0A] border border-[#333] text-[11px] text-[#E0E0E0] px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666] mb-1">To</span>
          <input
            type="date"
            name="to"
            defaultValue={toStr}
            className="bg-[#0A0A0A] border border-[#333] text-[11px] text-[#E0E0E0] px-2 py-1"
          />
        </label>
        <button
          type="submit"
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold"
        >
          Apply
        </button>
        <Link
          href={`/ct?from=${fy.from.toISOString().slice(0, 10)}&to=${fy.to.toISOString().slice(0, 10)}`}
          className="text-[10px] uppercase tracking-widest text-[#888] hover:text-[#FF6600] px-3 py-1.5"
        >
          Reset to {fy.label}
        </Link>
      </form>

      <div className="grid grid-cols-3 gap-2">
        <KPI label="Taxable profit" value={taxableProfit} color={taxableProfit >= 0 ? "#00CC66" : "#FF3333"} />
        <KPI label="CT liability" value={result.tax} color="#FF6600" />
        <KPI
          label="Effective rate"
          value={result.effectiveRate * 100}
          color="#FFCC00"
          suffix="%"
          decimals={2}
        />
      </div>

      <div className="border border-[#2A2A2A]">
        <div className="bg-[#1A1A1A] px-3 py-2 text-[10px] uppercase tracking-widest text-[#FF6600]">
          Computation
        </div>
        <table className="w-full text-[11px] bb-mono">
          <tbody>
            <Row label="Revenue" value={totalRevenue} colour="#00CC66" />
            <Row label="Cost of sales" value={-totalCogs} colour="#FF9900" />
            <Row label="Gross profit" value={grossProfit} bold />
            <Row label="Operating expenses" value={-totalOpex} colour="#FF3333" />
            <Row label="Accounting profit (PBT)" value={accountingProfit} bold />
            <Row label="Add back: depreciation (disallowable)" value={totalDepreciation} colour="#FFCC00" />
            <Row label="Taxable profit" value={taxableProfit} bold accent />
            <Row
              label={
                result.band === "LOSS"
                  ? "Band: LOSS — no CT due"
                  : result.band === "SMALL"
                    ? `Band: SMALL PROFITS (≤ £${SMALL_PROFITS_LIMIT.toLocaleString("en-GB")}) @ 19%`
                    : result.band === "MAIN"
                      ? `Band: MAIN (> £${UPPER_LIMIT.toLocaleString("en-GB")}) @ 25%`
                      : `Band: MARGINAL (£${SMALL_PROFITS_LIMIT.toLocaleString("en-GB")} – £${UPPER_LIMIT.toLocaleString("en-GB")}) — 25% with marginal relief`
              }
              value={null}
            />
            <Row label="CT liability" value={result.tax} bold accent />
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-[#666] bb-mono">
        Source data:{" "}
        <Link
          href={`/finance/reports/p-and-l?from=${fromStr}&to=${toStr}`}
          className="text-[#FF6600] hover:underline"
        >
          P&amp;L for the period
        </Link>{" "}
        · Journal status filter: <code className="text-[#FFCC00]">POSTED</code> only.
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  colour,
  bold,
  accent,
}: {
  label: string;
  value: number | null;
  colour?: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <tr className={`border-t border-[#222] ${accent ? "bg-[#1A1A1A]" : ""}`}>
      <td className={`px-3 py-2 ${bold ? "text-[#CCCCCC] font-bold" : "text-[#888]"}`}>{label}</td>
      <td
        className="px-3 py-2 text-right tabular-nums"
        style={{
          color: colour ?? (bold ? "#FF6600" : "#CCCCCC"),
          fontWeight: bold ? 700 : 400,
        }}
      >
        {value == null ? "" : `£${fmt(value)}`}
      </td>
    </tr>
  );
}

function KPI({
  label,
  value,
  color,
  suffix,
  decimals,
}: {
  label: string;
  value: number;
  color: string;
  suffix?: string;
  decimals?: number;
}) {
  return (
    <div className="border border-[#333] bg-[#0B0B0B] rounded p-3">
      <div className="text-[9px] uppercase tracking-widest text-[#888]">{label}</div>
      <div className="text-base font-black tabular-nums mt-1" style={{ color }}>
        {suffix === "%"
          ? value.toFixed(decimals ?? 0) + "%"
          : "£" +
            value.toLocaleString("en-GB", {
              minimumFractionDigits: decimals ?? 2,
              maximumFractionDigits: decimals ?? 2,
            })}
      </div>
    </div>
  );
}

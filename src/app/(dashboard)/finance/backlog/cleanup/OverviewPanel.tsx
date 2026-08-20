"use client";

import type { CleanupInsights } from "@/lib/zoho/cleanup-insights";
import { fmt } from "./InsightTiles";

export function OverviewPanel({ insights }: { insights: CleanupInsights }) {
  const i = insights;
  const totalOutstanding = i.outstanding.balance || 1;

  // Pivot statusByYear into a grid
  const years = [...new Set(i.statusByYear.map((r) => r.year))].sort();
  const statuses = [...new Set(i.statusByYear.map((r) => r.status))].sort();
  const cellMap = new Map(i.statusByYear.map((r) => [`${r.year}|${r.status}`, r.count]));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Aging */}
      <Section title="Aging of Outstanding Balance">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-[#888888] border-b border-[#333333]">
              <th className="text-left  px-2 py-1.5">Bucket</th>
              <th className="text-right px-2 py-1.5 w-16">Count</th>
              <th className="text-right px-2 py-1.5 w-28">Balance</th>
              <th className="text-left  px-2 py-1.5 w-40">% of £</th>
            </tr>
          </thead>
          <tbody>
            {i.aging.map((b) => {
              const pct = (b.balance / totalOutstanding) * 100;
              const tone =
                b.bucket === ">365"
                  ? "bg-[#FF3333]"
                  : b.bucket === "181-365"
                  ? "bg-[#FF6600]"
                  : b.bucket === "91-180"
                  ? "bg-[#FF9900]"
                  : "bg-[#00CC66]";
              return (
                <tr key={b.bucket} className="border-b border-[#1F1F1F] text-[#E0E0E0]">
                  <td className="px-2 py-1.5">{b.bucket}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{b.count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">£{fmt(b.balance)}</td>
                  <td className="px-2 py-1.5">
                    <div className="bg-[#0A0A0A] h-3 relative">
                      <div className={`${tone} h-full`} style={{ width: `${Math.min(100, pct)}%` }} />
                    </div>
                    <div className="text-[9px] text-[#666666] mt-0.5">{pct.toFixed(1)}%</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* Status × Year */}
      <Section title="Status by Year">
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="uppercase tracking-widest text-[#888888] border-b border-[#333333]">
                <th className="text-left px-2 py-1.5">Year</th>
                {statuses.map((s) => (
                  <th key={s} className="text-right px-2 py-1.5">
                    {s}
                  </th>
                ))}
                <th className="text-right px-2 py-1.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const total = statuses.reduce((s, st) => s + (cellMap.get(`${y}|${st}`) ?? 0), 0);
                return (
                  <tr key={y} className="border-b border-[#1F1F1F] text-[#E0E0E0]">
                    <td className="px-2 py-1.5">{y}</td>
                    {statuses.map((s) => {
                      const v = cellMap.get(`${y}|${s}`);
                      return (
                        <td key={s} className="px-2 py-1.5 text-right tabular-nums">
                          {v ?? "·"}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#FF6600] font-bold">
                      {total}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Top debtors */}
      <Section title="Top Debtors" wide>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[#888888] border-b border-[#333333]">
                <th className="text-left  px-2 py-1.5">Zoho Customer</th>
                <th className="text-left  px-2 py-1.5 w-40">Linked OS Customer</th>
                <th className="text-right px-2 py-1.5 w-16">Inv #</th>
                <th className="text-right px-2 py-1.5 w-28">Balance</th>
                <th className="text-right px-2 py-1.5 w-28">Oldest Due</th>
              </tr>
            </thead>
            <tbody>
              {i.topDebtors.slice(0, 15).map((d) => (
                <tr
                  key={d.zohoCustomerId ?? `na-${d.customerName}`}
                  className="border-b border-[#1F1F1F] text-[#E0E0E0]"
                >
                  <td className="px-2 py-1.5">{d.customerName ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    {d.linkedCustomerId ? (
                      <a
                        href={`/customers/${d.linkedCustomerId}`}
                        className="text-[#00CC66] hover:underline"
                      >
                        ✓ {d.linkedCustomerName}
                      </a>
                    ) : (
                      <span className="text-[#FF9900]">unlinked</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{d.count}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">£{fmt(d.balance)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[#888888]">
                    {d.oldestDue ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Anomalies + Cash */}
      <Section title="Anomalies & Catch-alls" wide>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat
            label="Void w/ balance"
            value={String(i.anomalies.voidWithBalance.count)}
            sub={`£${fmt(i.anomalies.voidWithBalance.balance)}`}
            tone="alert"
          />
          <MiniStat
            label="Closed w/ balance"
            value={String(i.anomalies.closedWithBalance.count)}
            sub={`£${fmt(i.anomalies.closedWithBalance.balance)}`}
            tone={i.anomalies.closedWithBalance.count > 0 ? "warn" : "ok"}
          />
          <MiniStat label="£0 invoices" value={String(i.anomalies.zeroTotal)} tone="warn" />
          <MiniStat
            label="Cash Account"
            value={String(i.cashAccount.count)}
            sub={`£${fmt(i.cashAccount.balance)} owed`}
            tone="warn"
          />
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`bg-[#1A1A1A] border border-[#333333] ${wide ? "lg:col-span-2" : ""}`}>
      <div className="border-b border-[#333333] px-3 py-2 text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "alert" | "ok";
}) {
  const color =
    tone === "alert"
      ? "text-[#FF3333]"
      : tone === "warn"
      ? "text-[#FF9900]"
      : tone === "ok"
      ? "text-[#00CC66]"
      : "text-[#E0E0E0]";
  return (
    <div className="border border-[#333333] bg-[#0A0A0A] p-2">
      <div className="text-[10px] uppercase tracking-widest text-[#888888]">{label}</div>
      <div className={`text-base font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#666666]">{sub}</div>}
    </div>
  );
}

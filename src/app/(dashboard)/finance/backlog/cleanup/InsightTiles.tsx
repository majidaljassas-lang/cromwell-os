"use client";

import type { CleanupInsights } from "@/lib/zoho/cleanup-insights";

const fmt = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmt2 = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Tile({
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
  const accent =
    tone === "warn"
      ? "border-[#FF9900] text-[#FF9900]"
      : tone === "alert"
      ? "border-[#FF3333] text-[#FF3333]"
      : tone === "ok"
      ? "border-[#00CC66] text-[#00CC66]"
      : "border-[#FF6600] text-[#FF6600]";
  return (
    <div className="bg-[#1A1A1A] border border-[#333333] p-3">
      <div className="text-[10px] uppercase tracking-widest text-[#888888]">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-1 ${accent.split(" ")[1]}`}>{value}</div>
      {sub && <div className="text-[10px] text-[#888888] mt-1">{sub}</div>}
      <div className={`mt-2 h-[2px] ${accent.split(" ")[0]} border-t`}></div>
    </div>
  );
}

export function InsightTiles({ insights }: { insights: CleanupInsights }) {
  const i = insights;
  const customerCoverage =
    i.mappingCoverage.distinctZohoCustomers === 0
      ? 0
      : (i.mappingCoverage.linkedZohoCustomers / i.mappingCoverage.distinctZohoCustomers) * 100;
  const siteCoverage =
    i.mappingCoverage.distinctCfSites === 0
      ? 0
      : (i.mappingCoverage.linkedCfSites / i.mappingCoverage.distinctCfSites) * 100;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Tile
        label="Total Invoices"
        value={fmt(i.totalInvoices)}
        sub={`as of ${i.asOf.slice(0, 10)}`}
      />
      <Tile
        label="Outstanding £"
        value={`£${fmt(i.outstanding.balance)}`}
        sub={`${i.outstanding.count} invoices`}
        tone="alert"
      />
      <Tile
        label=">365d Overdue"
        value={`£${fmt(i.aging.find((b) => b.bucket === ">365")?.balance ?? 0)}`}
        sub={`${i.aging.find((b) => b.bucket === ">365")?.count ?? 0} invoices`}
        tone="alert"
      />
      <Tile
        label="Stale Drafts/Opens"
        value={fmt(i.staleDrafts.count)}
        sub={`£${fmt(i.staleDrafts.faceValue)} face value`}
        tone="warn"
      />
      <Tile
        label="Customer Mapping"
        value={`${customerCoverage.toFixed(0)}%`}
        sub={`${i.mappingCoverage.linkedZohoCustomers} / ${i.mappingCoverage.distinctZohoCustomers}`}
        tone={customerCoverage > 80 ? "ok" : "warn"}
      />
      <Tile
        label="Site Mapping"
        value={`${siteCoverage.toFixed(0)}%`}
        sub={`${i.mappingCoverage.linkedCfSites} / ${i.mappingCoverage.distinctCfSites}`}
        tone={siteCoverage > 80 ? "ok" : "warn"}
      />
    </div>
  );
}

export { fmt, fmt2 };

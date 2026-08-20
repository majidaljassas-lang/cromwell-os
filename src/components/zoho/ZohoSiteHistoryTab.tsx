"use client";

import { useEffect, useState } from "react";

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Line = {
  invoiceId: string;
  zohoNumber: string | null;
  invoiceDate: string | null;
  customerName: string | null;
  lineNumber: number;
  itemDesc: string | null;
  itemName: string | null;
  quantity: number | null;
  itemTotal: number | null;
};

type Resp = {
  cfSites: string[];
  invoiceCount: number;
  lineCount: number;
  totalRevenue: number;
  outstanding: number;
  recentLines: Line[];
};

export function ZohoSiteHistoryTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sites/${siteId}/zoho-history`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load"));
  }, [siteId]);

  if (err) return <div className="text-sm text-red-500 p-2">{err}</div>;
  if (!data) return <div className="text-sm text-muted-foreground p-2">Loading…</div>;
  if (data.cfSites.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-3 border rounded">
        No Zoho-mapped CF.Site values for this OS Site. Map historical Zoho site labels to this site
        from{" "}
        <a href="/finance/backlog/cleanup?tab=sites" className="text-orange-500 hover:underline">
          Backlog · Cleanup · Sites
        </a>
        .
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Zoho Invoices" value={String(data.invoiceCount)} />
        <Stat label="Zoho Line Items" value={String(data.lineCount)} />
        <Stat label="Closed Revenue (Zoho)" value={`£${fmt(data.totalRevenue)}`} />
        <Stat
          label="Outstanding (Zoho)"
          value={`£${fmt(data.outstanding)}`}
          tone={data.outstanding > 0 ? "alert" : "ok"}
        />
      </div>

      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Mapped CF.Site values: {data.cfSites.join(" · ")}
      </div>

      <div className="border bg-card overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="text-left  px-3 py-2 w-24">Date</th>
              <th className="text-left  px-3 py-2 w-28">Invoice #</th>
              <th className="text-left  px-3 py-2 w-44">Customer</th>
              <th className="text-left  px-3 py-2">Line</th>
              <th className="text-right px-3 py-2 w-16">Qty</th>
              <th className="text-right px-3 py-2 w-24">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.recentLines.map((l) => (
              <tr key={`${l.invoiceId}-${l.lineNumber}`} className="border-b hover:bg-muted/30">
                <td className="px-3 py-2">{l.invoiceDate ?? "—"}</td>
                <td className="px-3 py-2">{l.zohoNumber ?? "—"}</td>
                <td className="px-3 py-2">{l.customerName ?? "—"}</td>
                <td className="px-3 py-2">{l.itemDesc ?? l.itemName ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">£{fmt(l.itemTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.recentLines.length < data.lineCount && (
        <div className="text-[10px] text-muted-foreground">
          Showing {data.recentLines.length} most recent of {data.lineCount} total Zoho lines.
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "alert" | "ok";
}) {
  const accent =
    tone === "alert" ? "text-red-500" : tone === "ok" ? "text-green-500" : "text-foreground";
  return (
    <div className="border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-base font-bold tabular-nums mt-1 ${accent}`}>{value}</div>
    </div>
  );
}

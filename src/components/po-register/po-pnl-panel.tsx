"use client";

import { useEffect, useState } from "react";

type Pnl = {
  poNo: string;
  totals: {
    poLimit: number;
    poConsumed: number;
    poRemaining: number;
    sale: number;
    cost: number;
    margin: number;
    marginPct: number;
    lines: number;
    uncostedLines: number;
  };
  supplierBreakdown: Array<{
    supplier: string;
    lines: number;
    sale: number;
    cost: number;
    margin: number;
    marginPct: number;
  }>;
  callOffs: Array<{
    invoiceNo: string | null;
    status: string;
    issuedAt: string | null;
    sale: number;
    cost: number;
    margin: number;
    marginPct: number;
    lines: number;
  }>;
};

function gbp(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function marginColour(pct: number): string {
  if (pct >= 20) return "text-[#00CC66]";
  if (pct >= 10) return "text-[#FF9900]";
  if (pct >= 0) return "text-[#FF9900]";
  return "text-[#FF3333]";
}

export function PoPnlPanel({ poId }: { poId: string }) {
  const [data, setData] = useState<Pnl | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/customer-pos/${poId}/pnl`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) setError(d.error);
        else setData(d as Pnl);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [poId]);

  if (error)
    return (
      <div className="rounded border border-[#FF3333]/40 bg-[#FF3333]/10 p-3 text-xs">{error}</div>
    );
  if (!data)
    return (
      <div className="rounded border p-3 text-xs text-muted-foreground">Loading P&amp;L…</div>
    );

  const t = data.totals;

  return (
    <div className="rounded border p-3 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Sell</div>
          <div className="text-sm font-bold tabular-nums">{gbp(t.sale)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cost</div>
          <div className="text-sm font-bold tabular-nums">{gbp(t.cost)}</div>
          {t.uncostedLines > 0 && (
            <div className="text-[10px] text-[#FF9900]">
              {t.uncostedLines} line{t.uncostedLines === 1 ? "" : "s"} uncosted
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Margin</div>
          <div className={`text-sm font-bold tabular-nums ${marginColour(t.marginPct)}`}>
            {gbp(t.margin)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Margin %</div>
          <div className={`text-sm font-bold tabular-nums ${marginColour(t.marginPct)}`}>
            {t.marginPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {data.supplierBreakdown.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            By supplier
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-[10px]">
              <tr>
                <th className="text-left font-normal">Supplier</th>
                <th className="text-right font-normal">Lines</th>
                <th className="text-right font-normal">Cost</th>
                <th className="text-right font-normal">Sell</th>
                <th className="text-right font-normal">Margin</th>
                <th className="text-right font-normal">%</th>
              </tr>
            </thead>
            <tbody>
              {data.supplierBreakdown.map((s) => (
                <tr key={s.supplier}>
                  <td className="py-0.5">{s.supplier}</td>
                  <td className="py-0.5 text-right tabular-nums">{s.lines}</td>
                  <td className="py-0.5 text-right tabular-nums">{gbp(s.cost)}</td>
                  <td className="py-0.5 text-right tabular-nums">{gbp(s.sale)}</td>
                  <td className={`py-0.5 text-right tabular-nums ${marginColour(s.marginPct)}`}>
                    {gbp(s.margin)}
                  </td>
                  <td className={`py-0.5 text-right tabular-nums ${marginColour(s.marginPct)}`}>
                    {s.marginPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.callOffs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
            By call-off
          </div>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-[10px]">
              <tr>
                <th className="text-left font-normal">Invoice</th>
                <th className="text-left font-normal">Status</th>
                <th className="text-right font-normal">Lines</th>
                <th className="text-right font-normal">Cost</th>
                <th className="text-right font-normal">Sell</th>
                <th className="text-right font-normal">Margin</th>
                <th className="text-right font-normal">%</th>
              </tr>
            </thead>
            <tbody>
              {data.callOffs.map((c) => (
                <tr key={c.invoiceNo ?? Math.random()}>
                  <td className="py-0.5">{c.invoiceNo ?? "—"}</td>
                  <td className="py-0.5">{c.status}</td>
                  <td className="py-0.5 text-right tabular-nums">{c.lines}</td>
                  <td className="py-0.5 text-right tabular-nums">{gbp(c.cost)}</td>
                  <td className="py-0.5 text-right tabular-nums">{gbp(c.sale)}</td>
                  <td className={`py-0.5 text-right tabular-nums ${marginColour(c.marginPct)}`}>
                    {gbp(c.margin)}
                  </td>
                  <td className={`py-0.5 text-right tabular-nums ${marginColour(c.marginPct)}`}>
                    {c.marginPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

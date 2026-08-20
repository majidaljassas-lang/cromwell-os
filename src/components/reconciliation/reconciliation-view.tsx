"use client";

import { useEffect, useMemo, useState } from "react";

type InvoiceRow = {
  id: string;
  zohoNumber: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  total: number;
  balance: number;
  status: string | null;
  lineCount: number;
  cleared: number;
  unmatched: number;
  clearedValue: number;
  unmatchedValue: number;
};

type Candidate = {
  billLineId: string;
  billNo: string;
  vendor: string | null;
  billDate: string | null;
  cfSite: string | null;
  customerName: string | null;
  description: string;
  qty: number;
  rate: number;
  itemTotal: number;
  tier: "T1" | "T2" | "T3" | "T4";
  confidence: number;
  reason: string;
};

type DetailLine = {
  invoiceLineId: string;
  lineNumber: number;
  description: string;
  quantity: number;
  rate: number;
  itemTotal: number;
  cfSite: string | null;
  match: {
    status: "CLEARED" | "SUGGESTED" | "NO_MATCH";
    best: Candidate | null;
    alternates: Candidate[];
  };
};

type Detail = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  total: number;
  lines: DetailLine[];
  summary: {
    totalLines: number;
    cleared: number;
    suggested: number;
    noMatch: number;
    clearedValue: number;
    suggestedValue: number;
    noMatchValue: number;
  };
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TIER_COLOUR: Record<Candidate["tier"], string> = {
  T1: "#00CC66",
  T2: "#33CC99",
  T3: "#FFCC00",
  T4: "#FF9900",
};
const STATUS_COLOUR: Record<DetailLine["match"]["status"], string> = {
  CLEARED:   "#00CC66",
  SUGGESTED: "#FFCC00",
  NO_MATCH:  "#FF3333",
};

export function ReconciliationView() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"date_desc" | "uncleared_desc">("uncleared_desc");

  useEffect(() => {
    setLoadingList(true);
    fetch("/api/zoho-recon/invoices?limit=200&sort=date_desc")
      .then((r) => r.json())
      .then((d) => setInvoices(d.rows ?? []))
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setLoadingDetail(true);
    fetch(`/api/zoho-recon/invoice/${selectedId}`)
      .then((r) => r.json())
      .then((d) => setDetail(d))
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const filtered = useMemo(() => {
    let xs = invoices;
    if (filter) {
      const f = filter.toLowerCase();
      xs = xs.filter(
        (i) =>
          (i.zohoNumber || "").toLowerCase().includes(f) ||
          (i.customerName || "").toLowerCase().includes(f)
      );
    }
    if (sort === "uncleared_desc") {
      xs = [...xs].sort((a, b) => b.unmatchedValue - a.unmatchedValue);
    }
    return xs;
  }, [invoices, filter, sort]);

  const totals = useMemo(() => {
    const cl  = invoices.reduce((s, x) => s + x.clearedValue, 0);
    const un  = invoices.reduce((s, x) => s + x.unmatchedValue, 0);
    return { cleared: cl, unmatched: un, count: invoices.length };
  }, [invoices]);

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex gap-6 text-[11px] bb-mono border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2">
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">INVOICES (LOADED)</div>
          <div className="text-[#CCCCCC]">{totals.count}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">CLEARED £</div>
          <div className="text-[#00CC66]">£ {fmt(totals.cleared)}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">UNMATCHED £</div>
          <div className="text-[#FF9900]">£ {fmt(totals.unmatched)}</div>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <input
            placeholder="filter invoice / customer"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[11px] px-2 py-1 w-64"
          />
          <button
            onClick={() => setSort(sort === "uncleared_desc" ? "date_desc" : "uncleared_desc")}
            className="text-[10px] tracking-widest text-[#888888] hover:text-[#FF6600] border border-[#333333] px-2 py-1 bb-mono"
          >
            SORT: {sort === "uncleared_desc" ? "UNCLEARED £" : "DATE"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* LEFT: invoice list */}
        <div className="col-span-4 border border-[#2A2A2A]">
          <div className="text-[10px] tracking-widest text-[#888888] bb-mono px-3 py-1 bg-[#1A1A1A]">
            INVOICES &nbsp;·&nbsp; {filtered.length}
          </div>
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
            {loadingList && <div className="text-[11px] text-[#888888] bb-mono p-3">Loading…</div>}
            {!loadingList && filtered.length === 0 && (
              <div className="text-[11px] text-[#666666] bb-mono p-3">No invoices.</div>
            )}
            <table className="w-full text-[11px] bb-mono">
              <tbody>
                {filtered.map((i) => {
                  const sel = i.id === selectedId;
                  const pct = i.lineCount > 0 ? Math.round((i.cleared / i.lineCount) * 100) : 0;
                  return (
                    <tr
                      key={i.id}
                      onClick={() => setSelectedId(i.id)}
                      className={`border-t border-[#222222] cursor-pointer ${sel ? "bg-[#1F1F1F]" : "hover:bg-[#161616]"}`}
                    >
                      <td className="px-3 py-1.5 align-top">
                        <div className={sel ? "text-[#FF6600]" : "text-[#CCCCCC]"}>{i.zohoNumber}</div>
                        <div className="text-[10px] text-[#888888]">{(i.customerName || "—").slice(0, 28)}</div>
                        <div className="text-[10px] text-[#666666]">{i.invoiceDate?.slice(0,10)}</div>
                      </td>
                      <td className="px-3 py-1.5 align-top text-right">
                        <div className="text-[#CCCCCC]">£ {fmt(i.total)}</div>
                        <div className="text-[10px]">
                          <span className="text-[#00CC66]">£{fmt(i.clearedValue)}</span>
                          <span className="text-[#666666]"> / </span>
                          <span className="text-[#FF9900]">£{fmt(i.unmatchedValue)}</span>
                        </div>
                        <div className="text-[10px] text-[#666666]">
                          {i.cleared}/{i.lineCount} cleared ({pct}%)
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: invoice detail */}
        <div className="col-span-8 border border-[#2A2A2A]">
          {!selectedId && (
            <div className="text-[11px] text-[#666666] bb-mono p-6 text-center">
              Select an invoice on the left to see line-level matches.
            </div>
          )}
          {loadingDetail && (
            <div className="text-[11px] text-[#888888] bb-mono p-6">Computing matches…</div>
          )}
          {detail && !loadingDetail && (
            <div>
              <div className="bg-[#1A1A1A] px-3 py-2 border-b border-[#2A2A2A]">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-[#FF6600] tracking-widest bb-mono text-sm">{detail.invoiceNumber}</span>
                    <span className="text-[#888888] bb-mono text-[11px] ml-3">{detail.customerName}</span>
                    <span className="text-[#666666] bb-mono text-[10px] ml-3">{detail.invoiceDate?.slice(0,10)}</span>
                  </div>
                  <div className="text-[#CCCCCC] bb-mono text-sm">£ {fmt(detail.total)}</div>
                </div>
                <div className="flex gap-4 mt-2 text-[10px] bb-mono">
                  <span className="text-[#00CC66]">CLEARED {detail.summary.cleared} · £{fmt(detail.summary.clearedValue)}</span>
                  <span className="text-[#FFCC00]">SUGGESTED {detail.summary.suggested} · £{fmt(detail.summary.suggestedValue)}</span>
                  <span className="text-[#FF3333]">NO MATCH {detail.summary.noMatch} · £{fmt(detail.summary.noMatchValue)}</span>
                </div>
              </div>

              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                <table className="w-full text-[11px] bb-mono">
                  <thead className="bg-[#1A1A1A] text-[#888888] uppercase tracking-widest text-[10px]">
                    <tr>
                      <th className="text-left px-2 py-1.5 w-[42%]">Invoice line</th>
                      <th className="text-right px-2 py-1.5">Qty</th>
                      <th className="text-right px-2 py-1.5">Rate</th>
                      <th className="text-right px-2 py-1.5">Total</th>
                      <th className="text-left px-2 py-1.5 w-[42%]">Best bill match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.invoiceLineId} className="border-t border-[#222222] align-top">
                        <td className="px-2 py-1.5 text-[#CCCCCC]">
                          <div className="flex gap-1.5 items-baseline">
                            <span style={{ color: STATUS_COLOUR[l.match.status] }} className="text-[10px]">●</span>
                            <span>L{l.lineNumber}</span>
                            <span>{l.description}</span>
                          </div>
                          {l.cfSite && <div className="text-[10px] text-[#666666] mt-0.5">site: {l.cfSite}</div>}
                        </td>
                        <td className="px-2 py-1.5 text-right text-[#CCCCCC]">{l.quantity}</td>
                        <td className="px-2 py-1.5 text-right text-[#CCCCCC]">£{fmt(l.rate)}</td>
                        <td className="px-2 py-1.5 text-right text-[#CCCCCC]">£{fmt(l.itemTotal)}</td>
                        <td className="px-2 py-1.5 align-top">
                          {l.match.best ? (
                            <div>
                              <div>
                                <span style={{ color: TIER_COLOUR[l.match.best.tier] }} className="text-[10px] mr-1">{l.match.best.tier}</span>
                                <span className="text-[#CCCCCC]">{l.match.best.vendor}</span>
                                <span className="text-[#666666]"> · {l.match.best.billNo}</span>
                                <span className="text-[#666666]"> · {l.match.best.billDate?.slice(0,10)}</span>
                              </div>
                              <div className="text-[10px] text-[#888888] mt-0.5">
                                qty {l.match.best.qty} × £{fmt(l.match.best.rate)} = £{fmt(l.match.best.itemTotal)} · site={l.match.best.cfSite || "—"}
                              </div>
                              <div className="text-[10px] text-[#666666] mt-0.5">{l.match.best.reason}</div>
                              {l.match.alternates.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-[10px] text-[#888888] cursor-pointer hover:text-[#FF6600]">
                                    + {l.match.alternates.length} alternate(s)
                                  </summary>
                                  <div className="mt-1 space-y-0.5">
                                    {l.match.alternates.map((a, idx) => (
                                      <div key={idx} className="text-[10px] text-[#666666] pl-2">
                                        <span style={{ color: TIER_COLOUR[a.tier] }}>{a.tier}</span>
                                        {" "}· {a.vendor} {a.billNo} · qty {a.qty} × £{fmt(a.rate)} · site={a.cfSite || "—"}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          ) : (
                            <div className="text-[10px] text-[#FF3333]">no candidate in ±60 day window</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

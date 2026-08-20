"use client";

import { useEffect, useMemo, useState } from "react";
import { SplitModal } from "./split-modal";

type CloseStatus = "CLOSED" | "LINKED_OPEN" | "UNLINKED";

type Row = {
  source: "ZOHO" | "OS";
  billLineId: string;
  billDate: string | null;
  dueDate: string | null;
  vendor: string | null;
  paymentTermsLabel: string | null;
  billNo: string | null;
  billStatus: string | null;
  account: string | null;
  qty: number;
  rate: number;
  itemTotal: number;
  description: string;
  customerName: string | null;
  cfSite: string | null;
  originalCfSite: string | null;
  originalCustomerName: string | null;
  siteInherited: boolean;
  customerInherited: boolean;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  profit: number | null;
  margin: number | null;
  invoiceStatus: string | null;
  closeStatus: CloseStatus;
  splitCount: number;
  splitSummary: string | null;
};

type SortKey =
  | "billDate" | "vendor" | "billNo" | "qty" | "rate" | "itemTotal"
  | "description" | "customerName" | "cfSite"
  | "invoiceNumber" | "invoiceAmount" | "profit" | "margin" | "closeStatus";

const CLOSE_RANK: Record<CloseStatus, number> = { CLOSED: 0, LINKED_OPEN: 1, UNLINKED: 2 };

function compareRows(a: Row, b: Row, key: SortKey, dir: "asc" | "desc"): number {
  let av: string | number, bv: string | number;
  switch (key) {
    case "billDate":      av = a.billDate ?? ""; bv = b.billDate ?? ""; break;
    case "vendor":        av = (a.vendor || "").toLowerCase(); bv = (b.vendor || "").toLowerCase(); break;
    case "billNo":        av = (a.billNo || "").toLowerCase(); bv = (b.billNo || "").toLowerCase(); break;
    case "qty":           av = a.qty; bv = b.qty; break;
    case "rate":          av = a.rate; bv = b.rate; break;
    case "itemTotal":     av = a.itemTotal; bv = b.itemTotal; break;
    case "description":   av = (a.description || "").toLowerCase(); bv = (b.description || "").toLowerCase(); break;
    case "customerName":  av = (a.customerName || "").toLowerCase(); bv = (b.customerName || "").toLowerCase(); break;
    case "cfSite":        av = (a.cfSite || "").toLowerCase(); bv = (b.cfSite || "").toLowerCase(); break;
    case "invoiceNumber": av = (a.invoiceNumber || "").toLowerCase(); bv = (b.invoiceNumber || "").toLowerCase(); break;
    case "invoiceAmount": av = a.invoiceAmount ?? -Infinity; bv = b.invoiceAmount ?? -Infinity; break;
    case "profit":        av = a.profit ?? -Infinity; bv = b.profit ?? -Infinity; break;
    case "margin":        av = a.margin ?? -Infinity; bv = b.margin ?? -Infinity; break;
    case "closeStatus":   av = CLOSE_RANK[a.closeStatus]; bv = CLOSE_RANK[b.closeStatus]; break;
  }
  if (av < bv) return dir === "asc" ? -1 : 1;
  if (av > bv) return dir === "asc" ? 1 : -1;
  return 0;
}

type Payload = {
  rows: Row[];
  totalCount: number;
  shown: number;
  limit: number;
  offset: number;
  totals: {
    cost: number;
    revenue: number;
    profit: number;
    margin: number | null;
    closed:     { count: number; cost: number };
    linkedOpen: { count: number; cost: number };
    unlinked:   { count: number; cost: number };
  };
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const pct = (m: number | null | undefined) =>
  m == null ? "—" : `${(m * 100).toFixed(1)}%`;

const SOURCE_COLOUR: Record<Row["source"], string> = {
  ZOHO: "#888888",
  OS:   "#FF6600",
};

const BILL_STATUS_COLOUR: Record<string, string> = {
  Paid:          "#00CC66",
  POSTED:        "#00CC66",
  Closed:        "#00CC66",
  Open:          "#FFCC00",
  Overdue:       "#FF3333",
  PartiallyPaid: "#FFCC00",
  PENDING:       "#888888",
  Draft:         "#666666",
};

const INVOICE_STATUS_COLOUR: Record<string, string> = {
  Paid:    "#00CC66",
  Closed:  "#00CC66",
  Open:    "#FFCC00",
  Overdue: "#FF3333",
  Draft:   "#666666",
};

const CLOSE_STATUS_COLOUR: Record<CloseStatus, string> = {
  CLOSED:      "#00CC66",  // green: bill line linked to a paid/closed sales invoice
  LINKED_OPEN: "#FFCC00",  // yellow: linked but invoice still outstanding
  UNLINKED:    "#FF3333",  // red: no match — recovery target
};

const CLOSE_STATUS_LABEL: Record<CloseStatus, string> = {
  CLOSED:      "CLOSED",
  LINKED_OPEN: "LINK·OPEN",
  UNLINKED:    "UNLINKED",
};

export function MainView() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [closeChip, setCloseChip] = useState<"ALL" | CloseStatus>("ALL");
  const [page, setPage] = useState(0);
  const limit = 1000; // wider page so filters surface enough rows
  const [sortKey, setSortKey] = useState<SortKey>("billDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [splittingId, setSplittingId] = useState<string | null>(null);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "billDate" || k === "itemTotal" || k === "profit" || k === "margin" ? "desc" : "asc"); }
  }
  const sortIndicator = (k: SortKey) => sortKey !== k ? "" : sortDir === "asc" ? " ↑" : " ↓";

  function load() {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(page * limit),
      ...(filter ? { filter } : {}),
      ...(closeChip !== "ALL" ? { close: closeChip } : {}),
    });
    fetch(`/api/zoho-recon/main?${params}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [page, closeChip]);

  // Debounced filter — apply on Enter or after 400ms idle
  useEffect(() => {
    const t = setTimeout(() => load(), 400);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [filter]);

  const totals = data?.totals;
  const sortedRows = useMemo(() => {
    if (!data?.rows) return [];
    const arr = [...data.rows];
    arr.sort((a, b) => compareRows(a, b, sortKey, sortDir));
    return arr;
  }, [data?.rows, sortKey, sortDir]);

  return (
    <div className="space-y-3">
      {/* Stats bar */}
      <div className="flex flex-wrap gap-6 text-[11px] bb-mono border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 items-center">
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">SHOWING</div>
          <div className="text-[#CCCCCC]">{data?.shown ?? 0} of {data?.totalCount ?? "—"}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">COST £</div>
          <div className="text-[#CCCCCC]">£ {fmt(totals?.cost)}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">REVENUE £ (LINKED)</div>
          <div className="text-[#00CC66]">£ {fmt(totals?.revenue)}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">PROFIT</div>
          <div className="text-[#00CC66]">£ {fmt(totals?.profit)}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">BLENDED MARGIN</div>
          <div className="text-[#00CC66]">{pct(totals?.margin)}</div>
        </div>
        <div className="ml-auto">
          <input
            placeholder="filter (vendor, bill, customer, site, invoice…)"
            value={filter}
            onChange={(e) => { setPage(0); setFilter(e.target.value); }}
            className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[11px] px-2 py-1 w-72"
          />
        </div>
      </div>

      {/* Close-status filter chips */}
      <div className="flex gap-2 text-[10px] bb-mono">
        {(["ALL", "CLOSED", "LINKED_OPEN", "UNLINKED"] as const).map((s) => {
          const isOn = closeChip === s;
          let label = "ALL", count = 0, cost = 0, color = "#888888";
          if (s === "ALL") {
            label = `ALL · ${(totals?.closed.count ?? 0) + (totals?.linkedOpen.count ?? 0) + (totals?.unlinked.count ?? 0)}`;
          } else if (s === "CLOSED") {
            count = totals?.closed.count ?? 0; cost = totals?.closed.cost ?? 0; color = CLOSE_STATUS_COLOUR.CLOSED;
            label = `CLOSED · ${count} · £${fmt(cost)}`;
          } else if (s === "LINKED_OPEN") {
            count = totals?.linkedOpen.count ?? 0; cost = totals?.linkedOpen.cost ?? 0; color = CLOSE_STATUS_COLOUR.LINKED_OPEN;
            label = `LINKED·OPEN · ${count} · £${fmt(cost)}`;
          } else {
            count = totals?.unlinked.count ?? 0; cost = totals?.unlinked.cost ?? 0; color = CLOSE_STATUS_COLOUR.UNLINKED;
            label = `UNLINKED · ${count} · £${fmt(cost)}  ←  recovery target`;
          }
          return (
            <button
              key={s}
              onClick={() => { setPage(0); setCloseChip(s); }}
              className={`px-3 py-1 border tracking-widest transition-colors ${
                isOn ? "border-[#FF6600] text-[#FF6600]" : "border-[#333333] text-[#888888] hover:text-[#CCCCCC]"
              }`}
              style={!isOn && s !== "ALL" ? { color } : {}}
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={async () => {
            if (!confirm("Auto-close high-confidence (T1 SKU + T2 same-job) pairs across the entire bill book?")) return;
            setLoading(true);
            const r = await fetch("/api/zoho-recon/auto-close", { method: "POST" });
            const j = await r.json();
            alert(`Auto-close: ${j.closed ?? 0} new pairs locked in. ${j.error || ""}`);
            load();
          }}
          className="ml-auto px-3 py-1 border border-[#00CC66] text-[#00CC66] tracking-widest hover:bg-[#00CC66] hover:text-black"
        >
          ▶ CLOSE LOOPS (T1+T2)
        </button>
      </div>

      {/* Pagination */}
      <div className="flex items-center gap-2 text-[10px] bb-mono">
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || loading}
          className="border border-[#333333] px-2 py-1 text-[#888888] hover:text-[#FF6600] disabled:opacity-30"
        >
          ← PREV
        </button>
        <span className="text-[#666666]">page {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={loading || (data && data.shown < limit) || false}
          className="border border-[#333333] px-2 py-1 text-[#888888] hover:text-[#FF6600] disabled:opacity-30"
        >
          NEXT →
        </button>
        {loading && <span className="text-[#888888] ml-2">loading…</span>}
      </div>

      {/* Main table */}
      <div className="border border-[#2A2A2A] overflow-x-auto">
        <table className="w-full text-[10px] bb-mono">
          <thead className="bg-[#1A1A1A] text-[#888888] uppercase tracking-widest sticky top-0">
            <tr>
              <Th onClick={() => toggleSort("billDate")} active={sortKey === "billDate"}>Date{sortIndicator("billDate")}</Th>
              <Th onClick={() => toggleSort("vendor")} active={sortKey === "vendor"}>Vendor{sortIndicator("vendor")}</Th>
              <Th onClick={() => toggleSort("billNo")} active={sortKey === "billNo"}>Bill No{sortIndicator("billNo")}</Th>
              <th className="text-left px-2 py-1.5">Status</th>
              <Th onClick={() => toggleSort("qty")} active={sortKey === "qty"} align="right">Qty{sortIndicator("qty")}</Th>
              <Th onClick={() => toggleSort("rate")} active={sortKey === "rate"} align="right">Rate{sortIndicator("rate")}</Th>
              <Th onClick={() => toggleSort("itemTotal")} active={sortKey === "itemTotal"} align="right">Cost{sortIndicator("itemTotal")}</Th>
              <Th onClick={() => toggleSort("description")} active={sortKey === "description"}>Description{sortIndicator("description")}</Th>
              <Th onClick={() => toggleSort("customerName")} active={sortKey === "customerName"}>Customer{sortIndicator("customerName")}</Th>
              <Th onClick={() => toggleSort("cfSite")} active={sortKey === "cfSite"}>Site{sortIndicator("cfSite")}</Th>
              <Th onClick={() => toggleSort("closeStatus")} active={sortKey === "closeStatus"} className="border-l border-[#333333]">Bill Close{sortIndicator("closeStatus")}</Th>
              <Th onClick={() => toggleSort("invoiceNumber")} active={sortKey === "invoiceNumber"}>Invoice{sortIndicator("invoiceNumber")}</Th>
              <Th onClick={() => toggleSort("invoiceAmount")} active={sortKey === "invoiceAmount"} align="right">Inv £{sortIndicator("invoiceAmount")}</Th>
              <Th onClick={() => toggleSort("profit")} active={sortKey === "profit"} align="right">Profit{sortIndicator("profit")}</Th>
              <Th onClick={() => toggleSort("margin")} active={sortKey === "margin"} align="right">Margin{sortIndicator("margin")}</Th>
              <th className="text-left px-2 py-1.5">Inv Stat</th>
              <th className="text-left px-2 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => {
              const linked = !!r.invoiceNumber;
              return (
                <tr
                  key={r.billLineId}
                  className={`border-t border-[#222222] ${linked ? "" : ""} hover:bg-[#161616]`}
                >
                  <td className="px-2 py-1 text-[#888888]">{r.billDate?.slice(0,10) ?? "—"}</td>
                  <td className="px-2 py-1">
                    <span style={{ color: SOURCE_COLOUR[r.source] }} className="text-[9px] mr-1">{r.source}</span>
                    <span className="text-[#CCCCCC]">{(r.vendor || "—").slice(0,28)}</span>
                  </td>
                  <td className="px-2 py-1 text-[#CCCCCC]">{(r.billNo || "—").slice(0,18)}</td>
                  <td className="px-2 py-1">
                    <span style={{ color: BILL_STATUS_COLOUR[r.billStatus || ""] || "#888888" }}>
                      {(r.billStatus || "—").slice(0,10)}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right text-[#CCCCCC]">{r.qty || "—"}</td>
                  <td className="px-2 py-1 text-right text-[#CCCCCC]">£{fmt(r.rate)}</td>
                  <td className="px-2 py-1 text-right text-[#CCCCCC]">£{fmt(r.itemTotal)}</td>
                  <td className="px-2 py-1 text-[#CCCCCC]" title={r.description}>{(r.description || "").slice(0,48)}</td>
                  <td className="px-2 py-1">
                    {r.customerInherited ? (
                      <span title={`Inherited from invoice match (bill side: ${r.originalCustomerName || "—"})`}>
                        <span className="text-[#00CC66]">{(r.customerName || "—").slice(0,22)}</span>
                        <span className="text-[#444444] text-[8px] ml-1">↳inv</span>
                      </span>
                    ) : (
                      <span className="text-[#888888]">{(r.customerName || "—").slice(0,22)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1">
                    {r.siteInherited ? (
                      <span title={`Inherited from invoice match (bill said: ${r.originalCfSite || "—"})`}>
                        <span className="text-[#00CC66]">{(r.cfSite || "—").slice(0,22)}</span>
                        <span className="text-[#444444] text-[8px] ml-1">↳inv</span>
                      </span>
                    ) : (
                      <span className="text-[#888888]">{(r.cfSite || "—").slice(0,22)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1 border-l border-[#333333]">
                    <span style={{ color: CLOSE_STATUS_COLOUR[r.closeStatus] }} className="text-[9px] tracking-widest">
                      ● {CLOSE_STATUS_LABEL[r.closeStatus]}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    {linked ? (
                      <span className="text-[#00CC66]">{r.invoiceNumber}</span>
                    ) : (
                      <span className="text-[#444444]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.invoiceAmount != null ? <span className="text-[#00CC66]">£{fmt(r.invoiceAmount)}</span> : <span className="text-[#444444]">—</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.profit != null ? (
                      <span className={r.profit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>£{fmt(r.profit)}</span>
                    ) : <span className="text-[#444444]">—</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {r.margin != null ? (
                      <span className={r.margin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>{pct(r.margin)}</span>
                    ) : <span className="text-[#444444]">—</span>}
                  </td>
                  <td className="px-2 py-1">
                    {r.invoiceStatus ? (
                      <span style={{ color: INVOICE_STATUS_COLOUR[r.invoiceStatus] || "#888888" }}>
                        {r.invoiceStatus.slice(0,8)}
                      </span>
                    ) : <span className="text-[#444444]">—</span>}
                  </td>
                  <td className="px-2 py-1">
                    {r.source === "ZOHO" ? (
                      <button
                        onClick={() => setSplittingId(r.billLineId)}
                        className="text-[10px] tracking-widest text-[#FF6600] hover:underline"
                        title={r.splitSummary || "Split this line into multiple targets"}
                      >
                        SPLIT{r.splitCount > 0 ? ` (${r.splitCount})` : ""}
                      </button>
                    ) : (
                      <span className="text-[#444444] text-[9px]">os only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.rows.length === 0 && (
          <div className="text-[11px] text-[#666666] bb-mono py-8 text-center">No bill lines match.</div>
        )}
      </div>

      {/* Split summary lines (sub-row text) — shown beneath every row that has splits */}
      {sortedRows.some((r) => r.splitSummary) && (
        <div className="text-[10px] bb-mono text-[#888888] border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2">
          <div className="text-[#FF6600] tracking-widest mb-1">ACTIVE SPLITS</div>
          {sortedRows.filter((r) => r.splitSummary).map((r) => (
            <div key={`split-${r.billLineId}`} className="flex gap-3 py-0.5">
              <span className="text-[#666666]">{r.billNo}</span>
              <span className="text-[#CCCCCC] flex-1">{r.description.slice(0, 50)}</span>
              <span className="text-[#00CC66]">{r.splitSummary}</span>
            </div>
          ))}
        </div>
      )}

      {splittingId && (
        <SplitModal
          billLineId={splittingId}
          onClose={() => setSplittingId(null)}
          onSaved={() => { setSplittingId(null); load(); }}
        />
      )}
    </div>
  );
}

function Th({
  children, onClick, active, align = "left", className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      onClick={onClick}
      className={`${align === "right" ? "text-right" : "text-left"} px-2 py-1.5 cursor-pointer select-none hover:text-[#FF6600] ${active ? "text-[#FF6600]" : ""} ${className}`}
    >
      {children}
    </th>
  );
}

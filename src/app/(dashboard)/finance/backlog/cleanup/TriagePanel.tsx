"use client";

import { useEffect, useMemo, useState } from "react";
import type { CleanupInsights } from "@/lib/zoho/cleanup-insights";
import { fmt } from "./InsightTiles";

type Queue = "stale" | "void-with-balance" | "zero-total" | "cash-account";

type Row = {
  id: string;
  zohoNumber: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number | null;
  balance: number | null;
  status: string | null;
  cleanupDecision: string | null;
  cleanupDecisionAt: string | null;
  cleanupDecisionNote: string | null;
};

const DECISIONS = [
  { value: "VOID_IN_ZOHO", label: "Void in Zoho", tone: "alert" },
  { value: "REBILL", label: "Re-bill in OS", tone: "warn" },
  { value: "IGNORE", label: "Ignore", tone: "default" },
  { value: "ANOMALY_REVIEWED", label: "Reviewed", tone: "ok" },
];

export function TriagePanel({ insights }: { insights: CleanupInsights }) {
  const [queue, setQueue] = useState<Queue>("stale");
  const [hideDecided, setHideDecided] = useState(true);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function refresh() {
    setRows(null);
    fetch(`/api/finance/backlog/cleanup/triage?queue=${queue}`)
      .then((r) => r.json())
      .then((d) => setRows(d.rows));
  }
  useEffect(() => {
    refresh();
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const visible = useMemo(() => {
    if (!rows) return [];
    return hideDecided ? rows.filter((r) => !r.cleanupDecision) : rows;
  }, [rows, hideDecided]);

  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  function toggleAll() {
    const ns = new Set(selected);
    if (allSelected) visible.forEach((r) => ns.delete(r.id));
    else visible.forEach((r) => ns.add(r.id));
    setSelected(ns);
  }
  function toggleOne(id: string) {
    const ns = new Set(selected);
    ns.has(id) ? ns.delete(id) : ns.add(id);
    setSelected(ns);
  }

  async function applyDecision(decision: string) {
    if (selected.size === 0) return;
    const note = decision !== "NONE" ? prompt("Optional note for this decision:") || null : null;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/backlog/cleanup/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: [...selected], decision, note }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Decision failed");
      setSelected(new Set());
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }

  const queueDefs: Array<{ key: Queue; label: string; sub: string }> = [
    {
      key: "stale",
      label: "Stale Drafts/Opens",
      sub: `${insights.staleDrafts.count} · £${fmt(insights.staleDrafts.faceValue)}`,
    },
    {
      key: "void-with-balance",
      label: "Void w/ Balance",
      sub: `${insights.anomalies.voidWithBalance.count} · £${fmt(
        insights.anomalies.voidWithBalance.balance
      )}`,
    },
    {
      key: "zero-total",
      label: "£0 Invoices",
      sub: `${insights.anomalies.zeroTotal} rows`,
    },
    {
      key: "cash-account",
      label: "Cash Account",
      sub: `${insights.cashAccount.count} · £${fmt(insights.cashAccount.balance)} owed`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {queueDefs.map((q) => (
          <button
            key={q.key}
            onClick={() => setQueue(q.key)}
            className={`text-left p-3 border ${
              queue === q.key
                ? "border-[#FF6600] bg-[#FF66001A]"
                : "border-[#333333] bg-[#1A1A1A] hover:bg-[#222222]"
            }`}
          >
            <div className="text-[10px] uppercase tracking-widest text-[#888888]">{q.label}</div>
            <div className="text-base text-[#E0E0E0] mt-1">{q.sub}</div>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[10px] uppercase tracking-widest text-[#888888] flex items-center gap-1">
          <input
            type="checkbox"
            checked={hideDecided}
            onChange={(e) => setHideDecided(e.target.checked)}
          />
          Hide decided
        </label>
        <div className="text-[10px] text-[#888888]">
          {visible.length} shown · {selected.size} selected
        </div>
        <div className="ml-auto flex gap-1">
          {DECISIONS.map((d) => {
            const accent =
              d.tone === "alert"
                ? "bg-[#FF3333] text-black hover:bg-[#FF6666]"
                : d.tone === "warn"
                ? "bg-[#FF9900] text-black hover:bg-[#FFAA33]"
                : d.tone === "ok"
                ? "bg-[#00CC66] text-black hover:bg-[#33DD88]"
                : "bg-[#333333] text-[#E0E0E0] hover:bg-[#444444]";
            return (
              <button
                key={d.value}
                disabled={selected.size === 0 || busy}
                onClick={() => applyDecision(d.value)}
                className={`text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30 ${accent}`}
              >
                {d.label}
              </button>
            );
          })}
          <button
            disabled={selected.size === 0 || busy}
            onClick={() => applyDecision("NONE")}
            className="text-[10px] uppercase tracking-widest text-[#888888] px-3 py-2 disabled:opacity-30 hover:text-[#E0E0E0]"
          >
            Clear
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-[#3A0000] border border-[#FF3333] text-[11px] text-[#FF6666] px-3 py-2">
          {err}
        </div>
      )}

      {!rows && <div className="text-[11px] text-[#666666] p-4">Loading…</div>}
      {rows && (
        <div className="border border-[#333333] bg-[#1A1A1A] overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
                <th className="text-left px-3 py-2 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="text-left  px-3 py-2 w-24">Date</th>
                <th className="text-left  px-3 py-2 w-28">Invoice #</th>
                <th className="text-left  px-3 py-2">Customer</th>
                <th className="text-left  px-3 py-2 w-20">Status</th>
                <th className="text-right px-3 py-2 w-24">Total</th>
                <th className="text-right px-3 py-2 w-24">Balance</th>
                <th className="text-left  px-3 py-2 w-32">Decision</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-[11px] text-[#666666] py-6">
                    — empty —
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const sel = selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className={`border-b border-[#222222] hover:bg-[#222222] ${
                      sel ? "bg-[#FF66001A]" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.id)} />
                    </td>
                    <td className="px-3 py-2 text-xs text-[#E0E0E0]">{r.invoiceDate ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-[#E0E0E0]">{r.zohoNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-[#E0E0E0]">{r.customerName ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-[#888888]">{r.status ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">
                      {r.total != null ? `£${fmt(r.total)}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-right tabular-nums">
                      {r.balance != null && r.balance > 0 ? (
                        <span className="text-[#FF6600]">£{fmt(r.balance)}</span>
                      ) : (
                        <span className="text-[#666666]">£{fmt(r.balance ?? 0)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[10px]">
                      {r.cleanupDecision ? (
                        <span className="text-[#00CC66] uppercase tracking-widest">
                          {r.cleanupDecision}
                        </span>
                      ) : (
                        <span className="text-[#666666]">—</span>
                      )}
                      {r.cleanupDecisionNote && (
                        <div className="text-[9px] text-[#666666]">{r.cleanupDecisionNote}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

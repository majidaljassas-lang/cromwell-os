"use client";

import React, { useEffect, useState } from "react";

type Match = {
  ref: string;
  matched: boolean;
  source: "NATIVE" | "ZOHO_IMPORTED" | null;
  billId: string | null;
  paymentStatus: string | null;
};

type Statement = {
  id: string;
  createdAt: string;
  receivedAt: string;
  sender: { email: string | null; name: string | null };
  subject: string;
  totalRefs: number;
  matched: number;
  unmatched: number;
  matches: Match[];
};

type Totals = {
  statementCount: number;
  totalRefs: number;
  matched: number;
  unmatched: number;
  openUnmatchedTasks: number;
};

export function SupplierReconciliation({ supplierId }: { supplierId: string }) {
  const [statements, setStatements] = useState<Statement[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch(`/api/statements/recent?supplierId=${supplierId}&limit=200`);
      const j = await r.json();
      setStatements(j.statements ?? []);
      setTotals(j.totals ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const lastReconciledAt = statements[0]?.receivedAt ?? null;
  const overallPct =
    totals && totals.totalRefs > 0
      ? Math.round((totals.matched / totals.totalRefs) * 100)
      : 0;

  return (
    <div className="space-y-3">
      {/* Header strip */}
      <div className="flex items-baseline justify-between gap-3 flex-wrap text-xs">
        <div className="space-y-0.5">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">
            Last reconciled
          </div>
          <div className="text-[#E0E0E0] tabular-nums">
            {lastReconciledAt
              ? new Date(lastReconciledAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
        </div>
        {totals && totals.statementCount > 0 && (
          <div className="flex items-center gap-4">
            <Stat label="statements" value={totals.statementCount} colour="#FFCC00" />
            <Stat label="matched" value={totals.matched} colour="#00CC66" />
            <Stat label="watchlist" value={totals.unmatched} colour="#FF6600" />
            <Stat label="open chases" value={totals.openUnmatchedTasks} colour="#FF6600" />
            <Stat label="reconciled" value={`${overallPct}%`} colour="#00CC66" />
          </div>
        )}
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="h-6 px-2 text-[10px] uppercase tracking-widest border border-[#333] text-[#888] hover:text-[#CCC] disabled:opacity-30"
        >
          {loading ? "..." : "↻"}
        </button>
      </div>

      {/* Statements list */}
      {loading ? (
        <div className="text-xs text-[#888] py-2">Loading…</div>
      ) : statements.length === 0 ? (
        <div className="border border-[#222] bg-[#0A0A0A] p-3 text-xs text-[#666]">
          No statements processed for this supplier yet. Classify a statement in /inbox to populate.
        </div>
      ) : (
        <div className="border border-[#333] bg-[#0A0A0A]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#333]">
                <th className="p-2 w-6"></th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">
                  Date
                </th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">
                  Subject
                </th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal w-16">
                  Refs
                </th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal w-20">
                  Matched
                </th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal w-20">
                  Watchlist
                </th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal w-16">
                  Rate
                </th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => {
                const isOpen = expandedId === s.id;
                const rate = s.totalRefs > 0 ? Math.round((s.matched / s.totalRefs) * 100) : 0;
                const date = new Date(s.receivedAt);
                const rateColour = rate >= 80 ? "#00CC66" : rate >= 30 ? "#FFCC00" : "#FF6600";
                return (
                  <React.Fragment key={s.id}>
                    <tr
                      className={`border-b border-[#222] hover:bg-[#161616] cursor-pointer ${isOpen ? "bg-[#1A1A1A]" : ""}`}
                      onClick={() => setExpandedId(isOpen ? null : s.id)}
                    >
                      <td className="p-2 text-center text-[#666]">{isOpen ? "▾" : "▸"}</td>
                      <td className="p-2 text-[#888] tabular-nums whitespace-nowrap">
                        <div>{date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div>
                        <div className="text-[10px]">{date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                      </td>
                      <td className="p-2 max-w-md truncate text-[#CCC]" title={s.subject}>
                        {s.subject || <span className="text-[#666] italic">(no subject)</span>}
                      </td>
                      <td className="p-2 text-right tabular-nums text-[#888]">{s.totalRefs}</td>
                      <td className="p-2 text-right tabular-nums text-[#00CC66]">{s.matched}</td>
                      <td className="p-2 text-right tabular-nums text-[#FF6600]">{s.unmatched}</td>
                      <td className="p-2 text-right tabular-nums font-bold" style={{ color: rateColour }}>
                        {rate}%
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-[#0F0F0F]">
                        <td colSpan={7} className="p-3 border-b-2 border-[#FF6600]">
                          <RefDetail matches={s.matches} />
                          <div className="mt-2 text-[10px] text-[#666]">
                            <a
                              href={`/api/statements/${s.id}/debug`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#FF6600] hover:underline"
                            >
                              Inspect raw ↗
                            </a>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, colour }: { label: string; value: number | string; colour: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-widest text-[#888]">{label}</div>
      <div className="tabular-nums font-bold" style={{ color: colour }}>
        {value}
      </div>
    </div>
  );
}

function RefDetail({ matches }: { matches: Match[] }) {
  const matched = matches.filter((m) => m.matched);
  const unmatched = matches.filter((m) => !m.matched);
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#00CC66] mb-1">
          ✓ Matched ({matched.length})
        </div>
        <div className="border border-[#222] bg-[#0A0A0A] max-h-60 overflow-auto">
          {matched.length === 0 ? (
            <div className="p-2 text-[10px] text-[#666]">No bills matched yet.</div>
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {matched.map((m) => (
                  <tr key={m.ref} className="border-b border-[#1A1A1A]">
                    <td className="p-1.5 text-[#CCC] font-mono">{m.ref}</td>
                    <td className="p-1.5 text-right">
                      <span
                        className="inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                        style={{
                          color: m.source === "ZOHO_IMPORTED" ? "#FFCC00" : "#00CC66",
                          background: "rgba(255,255,255,0.05)",
                        }}
                      >
                        {m.source === "ZOHO_IMPORTED" ? "Zoho" : "OS"}
                      </span>
                    </td>
                    <td className="p-1.5 text-right text-[10px] text-[#888]">
                      {m.paymentStatus ?? ""}
                    </td>
                    <td className="p-1.5 text-right">
                      {m.billId && m.source === "NATIVE" && (
                        <a href={`/bills/${m.billId}`} className="text-[10px] text-[#FF6600] hover:underline">
                          view →
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#FF6600] mb-1">
          ⏳ Watchlist ({unmatched.length})
        </div>
        <div className="border border-[#222] bg-[#0A0A0A] max-h-60 overflow-auto">
          {unmatched.length === 0 ? (
            <div className="p-2 text-[10px] text-[#666]">All refs matched.</div>
          ) : (
            <table className="w-full text-[11px]">
              <tbody>
                {unmatched.map((m) => (
                  <tr key={m.ref} className="border-b border-[#1A1A1A]">
                    <td className="p-1.5 text-[#CCC] font-mono">{m.ref}</td>
                    <td className="p-1.5 text-right text-[10px] text-[#888]">waiting for bill</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

type Row = {
  id: string;
  transactionDate: string;
  amount: number;
  description: string;
  reference: string | null;
  transactionType: string;
  bankName: string;
};

type AccountOption = { id: string; code: string; name: string; type: string };

type Suggestion =
  | {
      matchType: "SALES_INVOICE";
      id: string;
      invoiceNo: string | null;
      customerName: string;
      totalSell: number;
      issuedAt: string | null;
      ticketTitle: string;
      ticketNo: number;
      score: "EXACT" | "CLOSE";
    }
  | {
      matchType: "SUPPLIER_BILL";
      id: string;
      billNo: string | null;
      supplierName: string;
      totalCost: number;
      billDate: string;
      score: "EXACT" | "CLOSE";
    };

function fmt(n: number): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function BankInboxBoard({
  unreconciled,
  matched,
  cleared,
  accounts,
}: {
  unreconciled: Row[];
  matched: Row[];
  cleared: Row[];
  accounts: AccountOption[];
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [direction, setDirection] = useState<"INFLOW" | "OUTFLOW" | null>(null);
  const [categoryAcct, setCategoryAcct] = useState<string>("");
  const [categoryDesc, setCategoryDesc] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function openTxn(t: Row) {
    setSelected(t);
    setSuggestions(null);
    setDirection(null);
    setCategoryAcct("");
    setCategoryDesc(t.description);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/bank-inbox/suggest?bankTransactionId=${t.id}`);
      const json = await res.json();
      if (res.ok) {
        setSuggestions(json.suggestions ?? []);
        setDirection(json.direction ?? null);
      } else {
        setError(json.error || "Failed to load suggestions");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
    } finally {
      setLoading(false);
    }
  }

  async function applyMatch(s: Suggestion) {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/bank-inbox/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankTransactionId: selected.id,
          matchType: s.matchType,
          matchId: s.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Match failed");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Match failed");
      setLoading(false);
    }
  }

  async function applyCategorize() {
    if (!selected || !categoryAcct || !categoryDesc) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/bank-inbox/categorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankTransactionId: selected.id,
          counterpartyAccountId: categoryAcct,
          description: categoryDesc,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Categorize failed");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Categorize failed");
      setLoading(false);
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <Column title="UNRECONCILED" rows={unreconciled} onSelect={openTxn} accent="#FF6600" />
        <Column title="MATCHED (suggested)" rows={matched} onSelect={openTxn} accent="#FFCC00" />
        <Column title="CLEARED" rows={cleared} onSelect={null} accent="#00CC66" />
      </div>

      {selected && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6"
          onClick={() => !loading && setSelected(null)}
        >
          <div
            className="bg-[#1A1A1A] border border-[#333333] w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#333333] px-4 py-3 flex items-baseline justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#888888]">
                  {dateShort(selected.transactionDate)} · {selected.bankName}
                </div>
                <div className="text-sm text-[#E0E0E0] mt-1">{selected.description}</div>
              </div>
              <div
                className={`text-lg font-bold tabular-nums ${
                  selected.amount > 0 ? "text-[#00CC66]" : "text-[#FF6600]"
                }`}
              >
                {selected.amount > 0 ? "+" : ""}£{fmt(selected.amount)}
              </div>
            </div>

            {error && (
              <div className="px-4 py-2 bg-[#3A0000] border-b border-[#FF3333] text-[11px] text-[#FF6666]">
                {error}
              </div>
            )}

            {/* Suggested matches */}
            <div className="p-4 border-b border-[#333333]">
              <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-2">
                Suggested matches {direction ? `(${direction})` : ""}
              </div>
              {loading && !suggestions && (
                <div className="text-[11px] text-[#666666]">Searching…</div>
              )}
              {suggestions && suggestions.length === 0 && (
                <div className="text-[11px] text-[#666666]">
                  No close matches. Categorize directly below.
                </div>
              )}
              <div className="space-y-1">
                {(suggestions ?? []).map((s) => (
                  <button
                    key={`${s.matchType}-${s.id}`}
                    onClick={() => applyMatch(s)}
                    disabled={loading}
                    className="w-full flex items-baseline justify-between px-3 py-2 border border-[#333333] hover:bg-[#222222] hover:border-[#FF6600] text-left text-xs disabled:opacity-50"
                  >
                    <div>
                      <div className="text-[#E0E0E0]">
                        {s.matchType === "SALES_INVOICE"
                          ? `${s.invoiceNo ?? "(no #)"} — ${s.customerName}`
                          : `${s.billNo ?? "(no #)"} — ${s.supplierName}`}
                      </div>
                      <div className="text-[10px] text-[#888888] mt-0.5">
                        {s.matchType === "SALES_INVOICE"
                          ? `Ticket #${s.ticketNo} · ${s.ticketTitle}`
                          : dateShort(s.billDate)}
                      </div>
                    </div>
                    <div className="flex items-baseline gap-3">
                      <span
                        className={`text-[9px] uppercase tracking-widest ${
                          s.score === "EXACT" ? "text-[#00CC66]" : "text-[#FFCC00]"
                        }`}
                      >
                        {s.score}
                      </span>
                      <span className="tabular-nums text-[#E0E0E0]">
                        £
                        {fmt(
                          s.matchType === "SALES_INVOICE"
                            ? s.totalSell
                            : s.totalCost
                        )}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Direct categorize */}
            <div className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-[#888888]">
                Or categorize directly
              </div>
              <select
                value={categoryAcct}
                onChange={(e) => setCategoryAcct(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
              >
                <option value="">— Pick an account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={categoryDesc}
                onChange={(e) => setCategoryDesc(e.target.value)}
                placeholder="Description for the journal entry"
                className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
              />
              <button
                onClick={applyCategorize}
                disabled={!categoryAcct || !categoryDesc || loading}
                className="w-full bg-[#FF6600] text-black text-xs font-bold uppercase tracking-widest py-2 disabled:opacity-30"
              >
                Post Journal & Mark Reconciled
              </button>
            </div>

            <div className="border-t border-[#333333] px-4 py-2 flex justify-end">
              <button
                onClick={() => setSelected(null)}
                disabled={loading}
                className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#E0E0E0]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Column({
  title,
  rows,
  onSelect,
  accent,
}: {
  title: string;
  rows: Row[];
  onSelect: ((t: Row) => void) | null;
  accent: string;
}) {
  return (
    <div className="border border-[#333333] bg-[#1A1A1A] flex flex-col max-h-[75vh]">
      <div
        className="px-3 py-2 border-b border-[#333333] flex items-baseline justify-between"
        style={{ color: accent }}
      >
        <span className="text-[10px] uppercase tracking-widest font-bold">{title}</span>
        <span className="text-[10px] tabular-nums">{rows.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <div className="px-3 py-6 text-[11px] text-[#666666] text-center">— empty —</div>
        )}
        {rows.map((t) => (
          <button
            key={t.id}
            onClick={onSelect ? () => onSelect(t) : undefined}
            disabled={!onSelect}
            className={`w-full text-left px-3 py-2 border-b border-[#222222] ${
              onSelect ? "hover:bg-[#222222] cursor-pointer" : "cursor-default"
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] text-[#888888] tabular-nums">
                {dateShort(t.transactionDate)}
              </span>
              <span
                className={`text-xs font-bold tabular-nums ${
                  t.amount > 0 ? "text-[#00CC66]" : "text-[#E0E0E0]"
                }`}
              >
                {t.amount > 0 ? "+" : ""}£{fmt(t.amount)}
              </span>
            </div>
            <div className="text-xs text-[#E0E0E0] mt-1 truncate">{t.description}</div>
            <div className="text-[10px] text-[#666666] mt-0.5">{t.bankName}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

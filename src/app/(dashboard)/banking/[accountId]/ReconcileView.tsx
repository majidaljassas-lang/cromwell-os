"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface MatchCandidate {
  id: string;
  type: "INVOICE" | "BILL";
  recordId: string;
  ref: string | null;
  score: number;
  confirmed: boolean;
  amount: number;
  date: string | null;
  partyName: string | null;
  invoiceNo: string | null;
  billNo: string | null;
  poNo: string | null;
}

interface Txn {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  type: string;
  matches: MatchCandidate[];
}

interface ChartAccount {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
}

interface Props {
  accountId: string;
  transactions: Txn[];
  chartAccounts: ChartAccount[];
}

const BEST_THRESHOLD = 80;

export function ReconcileView({ accountId, transactions, chartAccounts }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(transactions[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runMatcherBusy, setRunMatcherBusy] = useState(false);

  const selectedTxn = useMemo(
    () => transactions.find((t) => t.id === selected) ?? null,
    [transactions, selected],
  );

  async function callApi(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed");
        setBusy(false);
        return false;
      }
      router.refresh();
      setBusy(false);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
      setBusy(false);
      return false;
    }
  }

  async function runMatcher() {
    setRunMatcherBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/banking/match-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: accountId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Matcher failed");
      } else {
        router.refresh();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Matcher failed");
    }
    setRunMatcherBusy(false);
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Left: transaction list */}
      <div className="col-span-7 border border-[#333333] bg-[#1A1A1A]">
        <div className="border-b border-[#333333] flex items-center justify-between px-3 py-2">
          <span className="text-[9px] uppercase tracking-widest text-[#888888] font-bold">
            Statement ({transactions.length})
          </span>
          <button
            onClick={runMatcher}
            disabled={runMatcherBusy}
            className="text-[10px] px-2 py-1 border border-[#00CCFF] text-[#00CCFF] hover:bg-[#00CCFF] hover:text-black uppercase tracking-widest font-bold disabled:opacity-50"
          >
            {runMatcherBusy ? "Matching..." : "↻ Run Matcher"}
          </button>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[9px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-3 py-2 font-semibold">Statement Details</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Deposits</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Withdrawals</th>
              <th className="px-3 py-2 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[10px] text-[#666666] italic">
                  No transactions in this view.
                </td>
              </tr>
            )}
            {transactions.map((t) => {
              const isSel = selected === t.id;
              const bestCount = t.matches.filter((m) => m.score >= BEST_THRESHOLD).length;
              const possibleCount = t.matches.filter(
                (m) => m.score < BEST_THRESHOLD && m.score >= 50,
              ).length;
              return (
                <tr
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  className={
                    "border-b border-[#222222] cursor-pointer " +
                    (isSel ? "bg-[#2A1A0A]" : "hover:bg-[#222222]")
                  }
                >
                  <td className="px-3 py-2 text-[10px] text-[#888888] tabular-nums">
                    {new Date(t.date).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[#E0E0E0]">
                    <div className="truncate max-w-md">{t.description}</div>
                    {t.reference && (
                      <div className="text-[9px] text-[#666666]">{t.reference}</div>
                    )}
                    {(bestCount > 0 || possibleCount > 0) && (
                      <div className="flex gap-1 mt-1">
                        {bestCount > 0 && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-[#00CC66] text-black font-bold">
                            {bestCount} BEST
                          </span>
                        )}
                        {possibleCount > 0 && (
                          <span className="text-[8px] px-1.5 py-0.5 bg-[#444444] text-[#CCCCCC] font-bold">
                            {possibleCount} POSSIBLE
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right tabular-nums text-[#00CC66]">
                    {t.amount > 0 ? `£${t.amount.toFixed(2)}` : ""}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-right tabular-nums text-[#FF9966]">
                    {t.amount < 0 ? `£${Math.abs(t.amount).toFixed(2)}` : ""}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-right">
                    {isSel && <span className="text-[#FF6600]">→</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Right: match panel */}
      <div className="col-span-5">
        {selectedTxn ? (
          <MatchPanel
            txn={selectedTxn}
            chartAccounts={chartAccounts}
            busy={busy}
            error={error}
            callApi={callApi}
          />
        ) : (
          <div className="border border-[#333333] bg-[#1A1A1A] p-6 text-[11px] text-[#666666] italic">
            Select a transaction to see match suggestions.
          </div>
        )}
      </div>
    </div>
  );
}

function MatchPanel({
  txn,
  chartAccounts,
  busy,
  error,
  callApi,
}: {
  txn: Txn;
  chartAccounts: ChartAccount[];
  busy: boolean;
  error: string | null;
  callApi: (path: string, body: unknown) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<"match" | "manual">("match");
  const [pickedAccount, setPickedAccount] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const best = txn.matches.filter((m) => m.score >= BEST_THRESHOLD);
  const possible = txn.matches.filter((m) => m.score < BEST_THRESHOLD && m.score >= 50);

  async function confirm(matchId: string) {
    await callApi("/api/banking/match-confirm", { matchId });
  }
  async function dismiss(matchId: string) {
    await callApi("/api/banking/match-dismiss", { matchId });
  }
  async function categorise() {
    if (!pickedAccount) return;
    await callApi("/api/banking/categorise", {
      transactionId: txn.id,
      accountId: pickedAccount,
      notes: notes || undefined,
    });
    setNotes("");
    setPickedAccount("");
  }
  async function exclude() {
    await callApi("/api/banking/exclude", { transactionId: txn.id, exclude: true });
  }

  return (
    <div className="border border-[#333333] bg-[#1A1A1A]">
      {/* Selected txn summary */}
      <div className="border-b border-[#333333] p-3 space-y-1">
        <div className="text-[9px] uppercase tracking-widest text-[#888888]">
          Selected Transaction
        </div>
        <div className="text-[12px] text-[#E0E0E0] font-bold">{txn.description}</div>
        <div className="flex items-center gap-3">
          <span
            className={
              "text-base font-bold tabular-nums " +
              (txn.amount > 0 ? "text-[#00CC66]" : "text-[#FF9966]")
            }
          >
            £{Math.abs(txn.amount).toFixed(2)}
          </span>
          <span className="text-[10px] text-[#888888]">
            {new Date(txn.date).toLocaleDateString("en-GB")}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#333333]">
        <button
          onClick={() => setTab("match")}
          className={
            "flex-1 text-[10px] uppercase tracking-widest font-bold py-2 " +
            (tab === "match"
              ? "text-[#FF6600] border-b-2 border-[#FF6600] -mb-px"
              : "text-[#888888]")
          }
        >
          Match Transactions
        </button>
        <button
          onClick={() => setTab("manual")}
          className={
            "flex-1 text-[10px] uppercase tracking-widest font-bold py-2 " +
            (tab === "manual"
              ? "text-[#FF6600] border-b-2 border-[#FF6600] -mb-px"
              : "text-[#888888]")
          }
        >
          Categorise Manually
        </button>
      </div>

      {error && (
        <div className="border-b border-[#FF3333] bg-[#2A0A0A] p-2 text-[10px] text-[#FF3333]">
          {error}
        </div>
      )}

      {tab === "match" ? (
        <div className="p-3 space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#E0E0E0] font-bold mb-2">
              Best Matches{" "}
              <span className="text-[#888888]">({best.length.toString().padStart(2, "0")})</span>
            </div>
            {best.length === 0 && (
              <div className="text-[10px] text-[#666666] italic">No high-confidence matches.</div>
            )}
            {best.map((m) => (
              <CandidateRow
                key={m.id}
                m={m}
                onMatch={() => confirm(m.id)}
                onDismiss={() => dismiss(m.id)}
                busy={busy}
                primary
              />
            ))}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#E0E0E0] font-bold mb-2">
              Possible Matches{" "}
              <span className="text-[#888888]">({possible.length})</span>
            </div>
            {possible.length === 0 && (
              <div className="text-[10px] text-[#666666] italic">No partial matches.</div>
            )}
            {possible.map((m) => (
              <CandidateRow
                key={m.id}
                m={m}
                onMatch={() => confirm(m.id)}
                onDismiss={() => dismiss(m.id)}
                busy={busy}
              />
            ))}
          </div>

          <div className="pt-2 border-t border-[#333333]">
            <button
              onClick={exclude}
              disabled={busy}
              className="text-[9px] text-[#888888] hover:text-[#FF3333] uppercase tracking-widest"
            >
              Exclude this transaction
            </button>
          </div>
        </div>
      ) : (
        <div className="p-3 space-y-3">
          <div>
            <label className="text-[9px] uppercase tracking-widest text-[#888888] font-bold block mb-1">
              Category Account
            </label>
            <select
              value={pickedAccount}
              onChange={(e) => setPickedAccount(e.target.value)}
              className="w-full bg-[#0F0F0F] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1.5"
            >
              <option value="">— select account —</option>
              {chartAccounts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.accountCode} {c.accountName} ({c.accountType})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-widest text-[#888888] font-bold block mb-1">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-[#0F0F0F] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1.5"
              placeholder="e.g. Office supplies"
            />
          </div>
          <button
            onClick={categorise}
            disabled={busy || !pickedAccount}
            className="w-full text-[11px] px-3 py-2 border border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600] hover:text-black font-bold uppercase tracking-widest disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save Category"}
          </button>
          <button
            onClick={exclude}
            disabled={busy}
            className="w-full text-[9px] text-[#888888] hover:text-[#FF3333] uppercase tracking-widest pt-2 border-t border-[#333333]"
          >
            Exclude this transaction
          </button>
        </div>
      )}
    </div>
  );
}

function CandidateRow({
  m,
  onMatch,
  onDismiss,
  busy,
  primary = false,
}: {
  m: MatchCandidate;
  onMatch: () => void;
  onDismiss: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  const refLabel = m.invoiceNo || m.billNo || m.ref || "—";
  return (
    <div className="border border-[#222222] bg-[#0F0F0F] p-2 mb-2 flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#888888] uppercase">
            {m.type === "INVOICE" ? "Invoice" : "Bill"}
          </span>
          <span className="text-[11px] font-bold tabular-nums text-[#E0E0E0]">
            for £{m.amount.toFixed(2)}
          </span>
          <span
            className="text-[8px] px-1 py-0.5 font-bold"
            style={{
              background: m.score >= 80 ? "#00CC66" : "#444444",
              color: m.score >= 80 ? "#000" : "#CCC",
            }}
          >
            {m.score}
          </span>
        </div>
        <div className="text-[10px] text-[#888888] mt-1 truncate">
          {m.date && (
            <span>Dated {new Date(m.date).toLocaleDateString("en-GB")} · </span>
          )}
          {m.partyName && <span>{m.partyName}</span>}
        </div>
        <div className="text-[10px] text-[#888888]">
          {m.poNo && <span>PO {m.poNo} · </span>}
          <span className="text-[#00CCFF]">#{refLabel}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <button
          onClick={onMatch}
          disabled={busy}
          className={
            "text-[9px] px-2 py-1 font-bold uppercase tracking-widest disabled:opacity-50 " +
            (primary
              ? "bg-[#00CCFF] text-black hover:bg-[#00AADD]"
              : "border border-[#00CCFF] text-[#00CCFF] hover:bg-[#00CCFF] hover:text-black")
          }
        >
          {primary ? "Match" : "Select"}
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          className="text-[8px] text-[#666666] hover:text-[#FF3333] uppercase tracking-widest"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";

interface BankAccountRef {
  id: string;
  bankName: string;
  accountName: string;
}

interface MatchedTransaction {
  id: string;
  transactionDate: string;
  amount: number;
  description: string;
  reconciliationStatus: string;
  notes: string | null;
}

interface Props {
  bankAccounts: BankAccountRef[];
}

function fmt(val: number): string {
  return val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReconciliationSummary({ bankAccounts }: Props) {
  const [matchedTxns, setMatchedTxns] = useState<MatchedTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    fetchMatched();
  }, []);

  async function fetchMatched() {
    try {
      const res = await fetch("/api/finance/bank/transactions?status=MATCHED&limit=20");
      const data = await res.json();
      setMatchedTxns(data.transactions || []);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }

  if (loading) return null;
  if (matchedTxns.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
        Suggested Matches
        <span className="ml-2 text-[9px] bg-[#3399FF] text-black px-1.5 py-0.5 font-bold">
          {matchedTxns.length}
        </span>
      </h2>
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333] text-[10px] text-[#888888]">
          These transactions have suggested matches. Review and confirm or dismiss.
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-4 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-4 py-2 font-semibold">Description</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Amount</th>
              <th className="text-left px-4 py-2 font-semibold">Suggested Match</th>
            </tr>
          </thead>
          <tbody>
            {matchedTxns.map((txn) => {
              const isPositive = txn.amount >= 0;
              return (
                <tr
                  key={txn.id}
                  className="border-b border-[#222222] hover:bg-[#222222]"
                >
                  <td className="px-4 py-2 text-xs text-[#888888] tabular-nums">
                    {new Date(txn.transactionDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                    <div className="truncate max-w-[300px]">{txn.description}</div>
                  </td>
                  <td
                    className={`px-4 py-2 text-xs text-right tabular-nums font-mono ${
                      isPositive ? "text-[#00CC66]" : "text-[#FF3333]"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {"\u00A3"}{fmt(txn.amount)}
                  </td>
                  <td className="px-4 py-2 text-[10px] text-[#3399FF]">
                    {txn.notes || "Match details unavailable"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

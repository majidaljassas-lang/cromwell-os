"use client";

import { useState } from "react";

export function SyncButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function sync() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/banking/plaid/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Error: ${data.error || "sync failed"}`);
      } else {
        setResult(
          `+${data.transactionsAdded ?? 0} added · ~${data.transactionsModified ?? 0} updated · ${
            data.connectionsProcessed ?? 0
          } conns`,
        );
      }
      // refresh
      setTimeout(() => window.location.reload(), 1000);
    } catch (e: unknown) {
      setResult(`Error: ${e instanceof Error ? e.message : "sync failed"}`);
    }
    setLoading(false);
  }

  return (
    <div className="flex items-center gap-3">
      {result && <span className="text-[9px] text-[#888888]">{result}</span>}
      <button
        onClick={sync}
        disabled={loading}
        className="text-[10px] px-3 py-1 border border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600] hover:text-black uppercase tracking-widest font-bold disabled:opacity-50"
      >
        {loading ? "Syncing..." : "Sync Now"}
      </button>
    </div>
  );
}

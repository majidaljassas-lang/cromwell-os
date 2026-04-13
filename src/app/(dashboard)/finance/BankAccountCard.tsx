"use client";

import { useState, useRef } from "react";

interface BankAccountData {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  sortCode: string;
  currentBalance: number;
  lastSyncedAt: string | null;
  yapilyConnected: boolean;
  transactionCount: number;
}

interface Props {
  bankAccount: BankAccountData;
  unreconciledCount: number;
  matchedCount: number;
  yapilyConfigured: boolean;
}

function fmt(val: number): string {
  return val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BankAccountCard({ bankAccount, unreconciledCount, matchedCount, yapilyConfigured }: Props) {
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bankAccountId", bankAccount.id);

      const res = await fetch("/api/finance/bank/import-csv", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(data.message);
        // Reload the page to show new transactions
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      setMessage(`Import failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleReconcile() {
    setReconciling(true);
    setMessage(null);

    try {
      const res = await fetch("/api/finance/bank/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: bankAccount.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(
          `Reconciled ${data.reconciled}, suggested ${data.matched}, unresolved ${data.unreconciled}`
        );
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      setMessage(`Reconciliation failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setReconciling(false);
    }
  }

  async function handleYapilyConnect() {
    setConnecting(true);
    setMessage(null);

    try {
      const res = await fetch("/api/finance/bank/yapily/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionId: "barclays-business",
          bankAccountId: bankAccount.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else if (data.authorisationUrl) {
        window.location.href = data.authorisationUrl;
      }
    } catch (err) {
      setMessage(`Connect failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setConnecting(false);
    }
  }

  async function handleYapilySync() {
    setSyncing(true);
    setMessage(null);

    try {
      const res = await fetch("/api/finance/bank/yapily/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankAccountId: bankAccount.id }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(data.message);
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (err) {
      setMessage(`Sync failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="border border-[#333333] bg-[#1A1A1A] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#888888]">{bankAccount.bankName}</span>
        <span className="text-[10px] text-[#666666]">
          {bankAccount.sortCode} / {bankAccount.accountNumber}
        </span>
      </div>

      {/* Balance */}
      <div className="text-lg font-bold tabular-nums text-[#E0E0E0]">
        {"\u00A3"}{fmt(bankAccount.currentBalance)}
      </div>
      <div className="text-[10px] text-[#888888] mt-1">{bankAccount.accountName}</div>

      {/* Status badges */}
      <div className="flex items-center gap-2 mt-2">
        <span className="text-[9px] text-[#666666]">
          {bankAccount.transactionCount} txns
        </span>
        {unreconciledCount > 0 && (
          <span className="text-[9px] bg-[#FF6600] text-black px-1.5 py-0.5 font-bold">
            {unreconciledCount} unreconciled
          </span>
        )}
        {matchedCount > 0 && (
          <span className="text-[9px] bg-[#3399FF] text-black px-1.5 py-0.5 font-bold">
            {matchedCount} suggested
          </span>
        )}
        {bankAccount.yapilyConnected && (
          <span className="text-[9px] bg-[#00CC66] text-black px-1.5 py-0.5 font-bold">
            OPEN BANKING
          </span>
        )}
      </div>

      {/* Last synced */}
      {bankAccount.lastSyncedAt && (
        <div className="text-[9px] text-[#555555] mt-1">
          Last synced: {new Date(bankAccount.lastSyncedAt).toLocaleString("en-GB")}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {/* CSV Import */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleCSVImport}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="text-[10px] px-2 py-1 border border-[#444444] text-[#CCCCCC] hover:bg-[#333333] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? "Importing..." : "Import CSV"}
        </button>

        {/* Reconcile */}
        {unreconciledCount > 0 && (
          <button
            onClick={handleReconcile}
            disabled={reconciling}
            className="text-[10px] px-2 py-1 border border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reconciling ? "Reconciling..." : "Auto-Reconcile"}
          </button>
        )}

        {/* Yapily Connect */}
        {yapilyConfigured && !bankAccount.yapilyConnected && (
          <button
            onClick={handleYapilyConnect}
            disabled={connecting}
            className="text-[10px] px-2 py-1 border border-[#00CC66] text-[#00CC66] hover:bg-[#00CC66] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? "Connecting..." : "Connect Barclays"}
          </button>
        )}

        {/* Yapily Sync */}
        {bankAccount.yapilyConnected && (
          <button
            onClick={handleYapilySync}
            disabled={syncing}
            className="text-[10px] px-2 py-1 border border-[#00CC66] text-[#00CC66] hover:bg-[#00CC66] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? "Syncing..." : "Sync Transactions"}
          </button>
        )}
      </div>

      {/* Message */}
      {message && (
        <div
          className={`text-[10px] mt-2 px-2 py-1 ${
            message.startsWith("Error")
              ? "text-[#FF3333] bg-[#331111]"
              : "text-[#00CC66] bg-[#113311]"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}

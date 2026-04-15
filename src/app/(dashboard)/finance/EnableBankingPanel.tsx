"use client";

import { useState } from "react";

interface ConnectedSource {
  id: string;
  accountName: string | null;
  connectorStatus: string | null;
  lastSyncAt: string | null;
  txnCount: number;
  unreconciledCount: number;
  reauthRequired: boolean;
}

interface Props {
  connected: ConnectedSource[];
  /** true when ENABLE_APP_ID + ENABLE_JWT_KID + ENABLE_JWT_PRIVATE_KEY are all set */
  credentialsConfigured: boolean;
}

export function EnableBankingPanel({ connected, credentialsConfigured }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [aspspName, setAspspName] = useState("Nordea");
  const [aspspCountry, setAspspCountry] = useState("FI");
  const [message, setMessage] = useState<string | null>(null);

  async function handleConnect(overrideName?: string, overrideCountry?: string) {
    const name = overrideName ?? aspspName;
    const country = overrideCountry ?? aspspCountry;
    setAspspName(name); setAspspCountry(country);
    setConnecting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/enable-banking/start-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aspspName: name, aspspCountry: country }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (e) {
      setMessage(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/enable-banking/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(`Sync error: ${data.error}`);
      } else {
        setMessage(
          `Sync done — ${data.transactionsUpserted ?? 0} new txns, ${data.suggestionsCreated ?? 0} suggestions`
        );
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch (e) {
      setMessage(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }

  const hasReauth = connected.some((s) => s.reauthRequired);

  return (
    <div className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
        Enable Banking (Open Banking)
      </h2>

      {/* Reauth warning */}
      {hasReauth && (
        <div className="border border-[#FF3333] bg-[#1A0A0A] px-4 py-3 text-[11px] text-[#FF3333]">
          One or more bank connections require re-authorisation. The session has expired. Use
          &quot;Connect&quot; below to reconnect.
        </div>
      )}

      {/* Not configured */}
      {!credentialsConfigured && (
        <div className="border border-[#444444] bg-[#1A1A1A] px-4 py-3 text-[11px] text-[#888888]">
          Enable Banking credentials not configured. Add{" "}
          <span className="text-[#FF6600] font-mono">ENABLE_APP_ID</span>,{" "}
          <span className="text-[#FF6600] font-mono">ENABLE_JWT_KID</span>, and{" "}
          <span className="text-[#FF6600] font-mono">ENABLE_JWT_PRIVATE_KEY</span> to{" "}
          <span className="text-[#FF6600] font-mono">.env.local</span> then restart the server.
        </div>
      )}

      {/* Bank connect cards — one per bank, side by side so both can be added */}
      {credentialsConfigured && (() => {
        // Enable's SANDBOX has no UK banks — only Nordic/Baltic mocks.
        // Use Nordea FI to verify the full auth + sync flow works; once the app is
        // activated for PRODUCTION, flip these entries back to Barclays / Barclaycard.
        const banks = [
          { aspsp: "Nordea",           country: "FI", label: "Nordea (Sandbox)",      tagline: "FI mock bank — proves integration end-to-end" },
          { aspsp: "Nordea Corporate", country: "FI", label: "Nordea Corp (Sandbox)", tagline: "FI mock corporate — business PSU" },
        ];
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {banks.map((b) => {
              const existing = connected.find((s) => s.accountName?.toLowerCase().includes(b.aspsp.toLowerCase()));
              const isConnected = !!existing && existing.connectorStatus === "OK";
              const isReauth    = !!existing && existing.reauthRequired;
              return (
                <div key={b.aspsp} className="border border-[#333333] bg-[#1A1A1A] px-4 py-3">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-[11px] text-[#CCCCCC] font-semibold">{b.label}</div>
                      <div className="text-[10px] text-[#666666] mt-0.5">{b.tagline}</div>
                    </div>
                    {isConnected && <span className="text-[9px] px-1.5 py-0.5 border border-[#00CC66] text-[#00CC66]">CONNECTED</span>}
                    {isReauth    && <span className="text-[9px] px-1.5 py-0.5 border border-[#FF3333] text-[#FF3333]">REAUTH</span>}
                    {!existing   && <span className="text-[9px] px-1.5 py-0.5 border border-[#666666] text-[#666666]">NOT CONNECTED</span>}
                  </div>
                  {existing && (
                    <div className="text-[10px] text-[#888888] mb-2">
                      {existing.txnCount} txn · {existing.unreconciledCount} unreconciled
                      {existing.lastSyncAt ? ` · synced ${new Date(existing.lastSyncAt).toLocaleString("en-GB")}` : " · never synced"}
                    </div>
                  )}
                  <button
                    onClick={() => handleConnect(b.aspsp, b.country)}
                    disabled={connecting}
                    className="w-full text-[10px] px-3 py-1.5 border border-[#00CC66] text-[#00CC66] hover:bg-[#00CC66] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
                  >
                    {connecting && aspspName === b.aspsp
                      ? "Connecting..."
                      : isReauth
                        ? `Reconnect ${b.label} →`
                        : isConnected
                          ? `Reconnect ${b.label} →`
                          : `Connect ${b.label} →`}
                  </button>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Connected sources */}
      {connected.length > 0 && (
        <div className="border border-[#333333] bg-[#1A1A1A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
                <th className="text-left px-4 py-2 font-semibold">Bank</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-right px-4 py-2 font-semibold">Transactions</th>
                <th className="text-right px-4 py-2 font-semibold">Unreconciled</th>
                <th className="text-left px-4 py-2 font-semibold">Last Sync</th>
              </tr>
            </thead>
            <tbody>
              {connected.map((src) => (
                <tr key={src.id} className="border-b border-[#222222]">
                  <td className="px-4 py-2 text-xs text-[#E0E0E0]">{src.accountName ?? "Unknown"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 font-bold ${
                        src.reauthRequired
                          ? "bg-[#FF3333] text-black"
                          : src.connectorStatus === "OK"
                          ? "bg-[#00CC66] text-black"
                          : src.connectorStatus === "PENDING_AUTH"
                          ? "bg-[#FF9900] text-black"
                          : "bg-[#444444] text-[#CCCCCC]"
                      }`}
                    >
                      {src.reauthRequired ? "REAUTH REQUIRED" : src.connectorStatus ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                    {src.txnCount}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums">
                    {src.unreconciledCount > 0 ? (
                      <span className="text-[#FF6600] font-bold">{src.unreconciledCount}</span>
                    ) : (
                      <span className="text-[#888888]">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[10px] text-[#888888]">
                    {src.lastSyncAt
                      ? new Date(src.lastSyncAt).toLocaleString("en-GB")
                      : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Add another connection + manual sync */}
          <div className="px-4 py-3 border-t border-[#333333] flex items-center gap-3 flex-wrap">
            {credentialsConfigured && (
              <>
                <select
                  value={aspspName}
                  onChange={(e) => setAspspName(e.target.value)}
                  className="text-[10px] bg-[#111111] border border-[#444444] text-[#CCCCCC] px-2 py-1"
                >
                  <option>Barclays Business</option>
                  <option>Barclaycard</option>
                </select>
                <button
                  onClick={handleConnect}
                  disabled={connecting}
                  className="text-[10px] px-2 py-1 border border-[#444444] text-[#CCCCCC] hover:bg-[#333333] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {connecting ? "Connecting..." : "Add / Re-connect"}
                </button>
              </>
            )}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="text-[10px] px-2 py-1 border border-[#3399FF] text-[#3399FF] hover:bg-[#3399FF] hover:text-black disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? "Syncing..." : "Sync Now"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <div
          className={`text-[10px] px-3 py-2 ${
            message.startsWith("Error") || message.startsWith("Sync error") || message.startsWith("Failed") || message.startsWith("Sync failed")
              ? "text-[#FF3333] bg-[#331111] border border-[#FF3333]"
              : "text-[#00CC66] bg-[#113311] border border-[#00CC66]"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}

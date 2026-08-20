"use client";

import { useEffect, useState } from "react";

declare global {
  interface Window {
    Plaid?: {
      create: (config: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit?: () => void;
      }) => { open: () => void };
    };
  }
}

const PLAID_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

interface Props {
  label: string;
  mode?: "connect" | "reauth";
  connectionId?: string; // required for reauth mode
  variant?: "default" | "subtle";
}

export function PlaidConnectButton({
  label,
  mode = "connect",
  connectionId,
  variant = "default",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Plaid) {
      setScriptReady(true);
      return;
    }
    const existing = document.querySelector(`script[src="${PLAID_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => setScriptReady(true));
      return;
    }
    const s = document.createElement("script");
    s.src = PLAID_SCRIPT_SRC;
    s.async = true;
    s.onload = () => setScriptReady(true);
    s.onerror = () => setError("Failed to load Plaid Link script");
    document.head.appendChild(s);
  }, []);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        mode === "reauth" ? "/api/banking/plaid/reauth" : "/api/banking/plaid/link-token";
      const body = mode === "reauth" ? JSON.stringify({ connectionId }) : "{}";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed");
        setLoading(false);
        return;
      }

      if (!window.Plaid) {
        setError("Plaid Link not loaded");
        setLoading(false);
        return;
      }

      const handler = window.Plaid.create({
        token: data.linkToken,
        onSuccess: async (publicToken: string) => {
          try {
            const ex = await fetch("/api/banking/plaid/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ publicToken }),
            });
            const exData = await ex.json();
            if (!ex.ok) {
              setError(exData.error || "Exchange failed");
              setLoading(false);
              return;
            }
            window.location.href = `/banking?connected=${exData.connectionId}`;
          } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Exchange failed");
            setLoading(false);
          }
        },
        onExit: () => setLoading(false),
      });
      handler.open();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connect failed");
      setLoading(false);
    }
  }

  const cls =
    variant === "subtle"
      ? "text-[10px] px-2 py-1 border border-[#444444] text-[#CCCCCC] hover:bg-[#333333] hover:text-white disabled:opacity-50"
      : "text-[11px] px-3 py-1.5 border border-[#00CCFF] text-[#00CCFF] hover:bg-[#00CCFF] hover:text-black disabled:opacity-50 font-bold uppercase tracking-widest";

  return (
    <div className="inline-flex flex-col gap-1">
      <button onClick={start} disabled={loading || !scriptReady} className={cls}>
        {loading ? "Connecting..." : !scriptReady ? "Loading..." : label}
      </button>
      {error && <span className="text-[10px] text-[#FF3333]">{error}</span>}
    </div>
  );
}

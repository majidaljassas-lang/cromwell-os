"use client";

import { useState } from "react";

interface Props {
  providerName: string;
  displayName: string;
  label: string;
  variant?: "default" | "subtle";
}

export function ConnectButton({ providerName, displayName, label, variant = "default" }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/banking/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, displayName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Connect failed");
        setLoading(false);
        return;
      }
      window.location.href = data.authUrl;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Connect failed");
      setLoading(false);
    }
  }

  const cls =
    variant === "subtle"
      ? "text-[10px] px-2 py-1 border border-[#444444] text-[#CCCCCC] hover:bg-[#333333] hover:text-white disabled:opacity-50"
      : "text-[11px] px-3 py-1.5 border border-[#00CC66] text-[#00CC66] hover:bg-[#00CC66] hover:text-black disabled:opacity-50 font-bold uppercase tracking-widest";

  return (
    <div className="inline-flex flex-col gap-1">
      <button onClick={connect} disabled={loading} className={cls}>
        {loading ? "Redirecting..." : label}
      </button>
      {error && <span className="text-[10px] text-[#FF3333]">{error}</span>}
    </div>
  );
}

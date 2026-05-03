"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function QuickAddCashClient() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clientName, setClientName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setClientName("");
    setSiteName("");
    setPostcode("");
    setError(null);
  };

  async function submit() {
    setError(null);
    const res = await fetch("/api/customers/cash-client", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: clientName.trim(),
        siteName: siteName.trim(),
        postcode: postcode.trim() || undefined,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setOpen(false);
    reset();
    startTransition(() => {
      router.refresh();
      if (j.client?.id) router.push(`/customers/${j.client.id}`);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-[11px] bb-mono border border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600] hover:text-black transition-colors"
      >
        + QUICK ADD CASH CLIENT
      </button>
    );
  }

  return (
    <div className="border border-[#FF6600] bg-[#1A1A1A] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.2em] text-[#FF6600] bb-mono">
          QUICK ADD · CASH CLIENT
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          className="text-[10px] text-[#888888] hover:text-[#FF6600] bb-mono"
        >
          ✕
        </button>
      </div>
      <div className="text-[9px] text-[#888888] bb-mono">
        Creates a sub of Cash Accounts (inherits Pro-Forma terms) + a site for the job.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          placeholder="Client name (e.g. Nadine Obayda)"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
        />
        <input
          type="text"
          placeholder="Site name (e.g. 22 Cardinal Crescent)"
          value={siteName}
          onChange={(e) => setSiteName(e.target.value)}
          className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
        />
        <input
          type="text"
          placeholder="Postcode (optional)"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending || !clientName.trim() || !siteName.trim()}
          className="px-3 py-1.5 text-[11px] bb-mono bg-[#FF6600] text-black hover:bg-[#FF7711] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {pending ? "CREATING…" : "CREATE"}
        </button>
      </div>
      {error && <div className="text-[10px] text-[#FF6666] bb-mono">{error}</div>}
    </div>
  );
}

"use client";

import { useState } from "react";

export function VatReturnPanel({
  suggestedStart,
  suggestedEnd,
}: {
  suggestedStart: string;
  suggestedEnd: string;
}) {
  const [periodStart, setPeriodStart] = useState(suggestedStart);
  const [periodEnd, setPeriodEnd] = useState(suggestedEnd);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/vat-return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart, periodEnd }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
        GENERATE / REFRESH RETURN
      </div>
      <div className="flex gap-3 items-end">
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">
            Period start
          </span>
          <input
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">
            Period end
          </span>
          <input
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1"
          />
        </label>
        <button
          onClick={generate}
          disabled={busy || !periodStart || !periodEnd}
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold disabled:opacity-30"
        >
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
      {err && <div className="text-[11px] text-[#FF6666]">{err}</div>}
    </div>
  );
}

export function SubmitButtonClient({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!confirm("Submit this VAT return? This posts the settlement JE.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/finance/vat-return/${id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Submit failed");
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Submit failed");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={submit}
      disabled={busy}
      className="text-[10px] uppercase tracking-widest text-[#00CC66] hover:underline font-bold disabled:opacity-30"
    >
      {busy ? "…" : "SUBMIT"}
    </button>
  );
}

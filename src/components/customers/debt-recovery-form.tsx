"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type InvoiceOption = { id: string; invoiceNo: string | null };

export function DebtRecoveryForm({
  customerId,
  trackerId,
  invoices,
}: {
  customerId: string;
  trackerId: string;
  invoices: InvoiceOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invoiceId, setInvoiceId] = useState("");
  const [net, setNet] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const netNum = Number(net);
  const gross = Number.isFinite(netNum) && netNum > 0 ? Math.round(netNum * 1.2 * 100) / 100 : 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/debt-recovery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackerId,
          salesInvoiceId: invoiceId || null,
          amount: gross, // stored gross; net/VAT derived in the register
          note: note || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "failed");
        return;
      }
      setInvoiceId("");
      setNet("");
      setNote("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("network error");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 text-[10px] px-2 py-1 text-[#00CC66] bg-[#00CC66]/10 hover:bg-[#00CC66]/20"
      >
        + Record recovery
      </button>
    );
  }

  return (
    <div className="mt-3 border border-[#333333] bg-[#222222] p-3 space-y-2">
      <div className="text-[10px] text-[#888888]">
        Record an uplift as a recovery (internal only — never shown to the customer). Enter the net
        uplift; VAT is added at 20% and the register tracks gross.
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={invoiceId}
          onChange={(e) => setInvoiceId(e.target.value)}
          className="text-[11px] bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] px-2 py-1"
        >
          <option value="">— link invoice (optional) —</option>
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.invoiceNo ?? i.id}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Net uplift £"
          value={net}
          onChange={(e) => setNet(e.target.value)}
          className="text-[11px] bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] px-2 py-1 w-28"
        />
        {gross > 0 && (
          <span className="text-[10px] text-[#888888]">
            + 20% VAT = <span className="text-[#E0E0E0]">£{gross.toFixed(2)}</span> gross
          </span>
        )}
        <input
          type="text"
          placeholder="Internal note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="text-[11px] bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0] px-2 py-1 flex-1 min-w-[160px]"
        />
      </div>
      {error && <div className="text-[10px] text-[#FF3333]">{error}</div>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy || !net}
          className="text-[10px] px-2 py-1 text-[#00CC66] bg-[#00CC66]/10 hover:bg-[#00CC66]/20 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save recovery"}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="text-[10px] px-2 py-1 text-[#888888] bg-[#333333] hover:bg-[#444444]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

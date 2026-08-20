"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Invoice = { id: string; label: string; total: number; outstanding: number };
type Bill = { id: string; supplierId: string; label: string; total: number; outstanding: number };
type Supplier = { id: string; name: string };

function fmt(n: number): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const PAYMENT_METHODS = ["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "DIRECT_DEBIT"];

export function PaymentsPanel({
  invoices,
  bills,
  suppliers,
}: {
  invoices: Invoice[];
  bills: Bill[];
  suppliers: Supplier[];
}) {
  const [tab, setTab] = useState<"IN" | "OUT">("IN");

  return (
    <div className="border border-[#333333] bg-[#1A1A1A]">
      <div className="border-b border-[#333333] flex">
        <button
          onClick={() => setTab("IN")}
          className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold ${
            tab === "IN"
              ? "text-[#00CC66] border-b-2 border-[#00CC66]"
              : "text-[#888888] hover:text-[#E0E0E0]"
          }`}
        >
          + Receipt (Customer Payment)
        </button>
        <button
          onClick={() => setTab("OUT")}
          className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold ${
            tab === "OUT"
              ? "text-[#FF3333] border-b-2 border-[#FF3333]"
              : "text-[#888888] hover:text-[#E0E0E0]"
          }`}
        >
          + Payment (Supplier Bill)
        </button>
      </div>
      <div className="p-4">
        {tab === "IN" ? (
          <ReceiptForm invoices={invoices} />
        ) : (
          <PayoutForm bills={bills} suppliers={suppliers} />
        )}
      </div>
    </div>
  );
}

function ReceiptForm({ invoices }: { invoices: Invoice[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selected = invoices.find((i) => i.id === invoiceId);

  function fillOutstanding() {
    if (selected) setAmount(selected.outstanding.toFixed(2));
  }

  async function submit() {
    if (!invoiceId || !amount || Number(amount) <= 0) {
      setErr("Pick an invoice and enter a positive amount.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesInvoiceId: invoiceId,
          amount: Number(amount),
          paymentDate,
          paymentMethod: method,
          reference: reference || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.refresh();
      setAmount("");
      setReference("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="border border-[#FF3333] bg-[#3A0000] text-[11px] text-[#FF6666] px-3 py-2">
          {err}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Invoice (open balance)">
          <select
            value={invoiceId}
            onChange={(e) => setInvoiceId(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          >
            <option value="">— pick invoice —</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label} · £{fmt(i.outstanding)} due
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Amount${selected ? ` (outstanding £${fmt(selected.outstanding)})` : ""}`}>
          <div className="flex gap-1">
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5 tabular-nums"
              placeholder="0.00"
            />
            {selected && (
              <button
                type="button"
                onClick={fillOutstanding}
                className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#FF6600] border border-[#333333] px-2"
              >
                Full
              </button>
            )}
          </div>
        </Field>
        <Field label="Payment date">
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          />
        </Field>
        <Field label="Method">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Reference (optional)">
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. bank ref / cheque #"
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          />
        </Field>
      </div>
      <button
        onClick={submit}
        disabled={busy || !invoiceId || !amount}
        className="bg-[#00CC66] text-black text-[10px] uppercase tracking-widest px-4 py-2 font-bold disabled:opacity-30"
      >
        {busy ? "Posting…" : "Record Receipt"}
      </button>
    </div>
  );
}

function PayoutForm({
  bills,
  suppliers,
}: {
  bills: Bill[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const supplierBills = bills.filter((b) => b.supplierId === supplierId);
  const totalAllocated = Object.values(allocations).reduce(
    (s, a) => s + (Number(a) || 0),
    0
  );

  function setAlloc(billId: string, value: string) {
    setAllocations((prev) => ({ ...prev, [billId]: value }));
  }
  function fillFull(b: Bill) {
    setAlloc(b.id, b.outstanding.toFixed(2));
  }

  async function submit() {
    const allocs = Object.entries(allocations)
      .map(([supplierBillId, v]) => ({ supplierBillId, amount: Number(v) }))
      .filter((a) => a.amount > 0);
    if (!supplierId) {
      setErr("Pick a supplier.");
      return;
    }
    if (allocs.length === 0) {
      setErr("Allocate at least one bill.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/payments-made", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          paymentDate,
          paymentMethod: method,
          reference: reference || undefined,
          allocations: allocs,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.refresh();
      setAllocations({});
      setReference("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="border border-[#FF3333] bg-[#3A0000] text-[11px] text-[#FF6666] px-3 py-2">
          {err}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Supplier">
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              setAllocations({});
            }}
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          >
            <option value="">— pick supplier —</option>
            {suppliers.map((s) => {
              const open = bills.filter((b) => b.supplierId === s.id);
              return (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {open.length > 0 ? ` (${open.length} open)` : ""}
                </option>
              );
            })}
          </select>
        </Field>
        <Field label="Payment date">
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          />
        </Field>
        <Field label="Method">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Reference (optional)">
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. bank ref / payment run id"
          className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
        />
      </Field>

      {supplierId && (
        <div className="border border-[#333333]">
          <div className="px-3 py-1.5 border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888] flex justify-between">
            <span>Allocate amount across bills</span>
            <span className="tabular-nums">Total allocated: £{fmt(totalAllocated)}</span>
          </div>
          {supplierBills.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-[#666666] text-center">
              No open bills for this supplier.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
                  <th className="text-left px-3 py-1.5 font-semibold">Bill</th>
                  <th className="text-right px-3 py-1.5 font-semibold w-28">Outstanding</th>
                  <th className="text-right px-3 py-1.5 font-semibold w-36">Allocate</th>
                </tr>
              </thead>
              <tbody>
                {supplierBills.map((b) => (
                  <tr key={b.id} className="border-b border-[#222222]">
                    <td className="px-3 py-1.5 text-xs text-[#E0E0E0]">{b.label}</td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums text-[#888888]">
                      £{fmt(b.outstanding)}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex gap-1">
                        <input
                          type="number"
                          step="0.01"
                          value={allocations[b.id] ?? ""}
                          onChange={(e) => setAlloc(b.id, e.target.value)}
                          className="flex-1 text-right bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1 tabular-nums"
                          placeholder="0.00"
                        />
                        <button
                          type="button"
                          onClick={() => fillFull(b)}
                          className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#FF6600] border border-[#333333] px-2"
                        >
                          Full
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || !supplierId || totalAllocated <= 0}
        className="bg-[#FF3333] text-black text-[10px] uppercase tracking-widest px-4 py-2 font-bold disabled:opacity-30"
      >
        {busy ? "Posting…" : `Record Payment £${fmt(totalAllocated)}`}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">{label}</span>
      {children}
    </label>
  );
}

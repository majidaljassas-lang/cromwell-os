"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Party = { id: string; name: string };
type Site = { id: string; siteName: string };

const UNITS = ["EA", "M", "LM", "LENGTH", "PACK", "LOT", "SET", "PAIR", "BOX", "ROLL", "TONNE"];

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputCls =
  "w-full bg-[#111111] border border-[#333333] px-2 py-1.5 text-xs text-[#E0E0E0] focus:border-[#FF6600] focus:outline-none";
const labelCls = "block text-[10px] uppercase tracking-widest text-[#888888] mb-1";

export function PaperEntryForm({
  customers,
  suppliers,
}: {
  customers: Party[];
  suppliers: Party[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const [entryDate, setEntryDate] = useState(today);
  const [description, setDescription] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("EA");
  const [actualCostUnit, setActualCostUnit] = useState("");
  const [agreedRateUnit, setAgreedRateUnit] = useState("");
  const [originBillNo, setOriginBillNo] = useState("");
  const [notes, setNotes] = useState("");

  const [sites, setSites] = useState<Site[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Customer first, site filtered — sites must be commercially linked to the customer.
  useEffect(() => {
    setSiteId("");
    if (!customerId) {
      setSites([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/customers/${customerId}/sites`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setSites(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setSites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const totals = useMemo(() => {
    const q = Number(qty) || 0;
    const cost = Math.round(q * (Number(actualCostUnit) || 0) * 100) / 100;
    const sale = Math.round(q * (Number(agreedRateUnit) || 0) * 100) / 100;
    return { cost, sale, margin: Math.round((sale - cost) * 100) / 100 };
  }, [qty, actualCostUnit, agreedRateUnit]);

  async function submit() {
    setErr(null);
    if (!description) return setErr("Description required");
    if (!customerId) return setErr("Customer required");
    if (!(Number(qty) > 0)) return setErr("Qty must be greater than zero");

    setBusy(true);
    try {
      const res = await fetch("/api/finance/paper-pnl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate,
          description,
          customerId,
          siteId: siteId || undefined,
          supplierId: supplierId || undefined,
          qty: Number(qty),
          unit,
          actualCostUnit: Number(actualCostUnit) || 0,
          agreedRateUnit: Number(agreedRateUnit) || 0,
          originBillNo: originBillNo || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Failed to save");
        return;
      }
      router.push("/finance/paper-pnl");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="border border-[#333333] bg-[#1A1A1A] p-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Date</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was given"
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Customer *</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className={inputCls}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Site</label>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={!customerId}
              className={`${inputCls} disabled:opacity-40`}
            >
              <option value="">
                {!customerId ? "Pick customer first" : sites.length ? "Select site…" : "No linked sites"}
              </option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.siteName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Supplier</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className={inputCls}
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          <div>
            <label className={labelCls}>Qty *</label>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              className={`${inputCls} tabular-nums text-right`}
            />
          </div>
          <div>
            <label className={labelCls}>Unit</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputCls}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Cost / unit</label>
            <input
              value={actualCostUnit}
              onChange={(e) => setActualCostUnit(e.target.value)}
              inputMode="decimal"
              placeholder="What we paid"
              className={`${inputCls} tabular-nums text-right`}
            />
          </div>
          <div>
            <label className={labelCls}>Agreed rate / unit</label>
            <input
              value={agreedRateUnit}
              onChange={(e) => setAgreedRateUnit(e.target.value)}
              inputMode="decimal"
              placeholder="Not charged"
              className={`${inputCls} tabular-nums text-right`}
            />
          </div>
          <div>
            <label className={labelCls}>Bill ref</label>
            <input
              value={originBillNo}
              onChange={(e) => setOriginBillNo(e.target.value)}
              placeholder="Optional"
              className={inputCls}
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">Real cost out</div>
          <div className="text-base tabular-nums text-[#FF3333] mt-1">£{fmt(totals.cost)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">Paper sale</div>
          <div className="text-base tabular-nums text-[#888888] mt-1">£{fmt(totals.sale)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">Paper margin</div>
          <div className="text-base tabular-nums text-[#FF6600] mt-1">£{fmt(totals.margin)}</div>
        </div>
      </div>

      {err && (
        <div className="border border-[#FF3333] text-[#FF3333] text-[11px] px-3 py-2">{err}</div>
      )}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-4 py-2 font-bold disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save entry"}
        </button>
        <button
          onClick={() => router.push("/finance/paper-pnl")}
          className="border border-[#333333] text-[#888888] text-[10px] uppercase tracking-widest px-4 py-2"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

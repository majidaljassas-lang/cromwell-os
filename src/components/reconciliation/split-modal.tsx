"use client";

import { useEffect, useState } from "react";

type Allocation = {
  targetType: "INVOICE" | "STOCK" | "WRITE_OFF" | "TICKET" | "PENDING";
  qty: number;
  invoiceNumber: string;
  targetCustomerName: string;
  targetSiteName: string;
  targetTicketRef: string;
  note: string;
};

type BillLineHeader = {
  id: string;
  vendor: string | null;
  billNo: string | null;
  description: string;
  qty: number;
  cost: number;
  cfSite: string | null;
  customerName: string | null;
};

const TARGET_COLOUR: Record<Allocation["targetType"], string> = {
  INVOICE:   "#00CC66",
  STOCK:     "#3399FF",
  TICKET:    "#FFCC00",
  PENDING:   "#FF9900",
  WRITE_OFF: "#FF3333",
};

function emptyAlloc(): Allocation {
  return {
    targetType: "INVOICE", qty: 0,
    invoiceNumber: "", targetCustomerName: "", targetSiteName: "",
    targetTicketRef: "", note: "",
  };
}

export function SplitModal({
  billLineId,
  onClose,
  onSaved,
}: {
  billLineId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [header, setHeader] = useState<BillLineHeader | null>(null);
  const [allocs, setAllocs] = useState<Allocation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/zoho-recon/bill-line/${billLineId}/splits`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setHeader(d.billLine);
        if (d.splits && d.splits.length > 0) {
          setAllocs(d.splits.map((s: any) => ({
            targetType: s.targetType,
            qty: s.qtyAllocated,
            invoiceNumber: s.invoiceNumber || "",
            targetCustomerName: s.targetCustomerName || "",
            targetSiteName: s.targetSiteName || "",
            targetTicketRef: s.targetTicketRef || "",
            note: s.note || "",
          })));
        } else {
          // Seed with one row matching the full qty
          setAllocs([{ ...emptyAlloc(), qty: d.billLine.qty }]);
        }
      });
  }, [billLineId]);

  function update(i: number, patch: Partial<Allocation>) {
    setAllocs((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function addRow()    { setAllocs((prev) => [...prev, emptyAlloc()]); }
  function removeRow(i: number) { setAllocs((prev) => prev.filter((_, idx) => idx !== i)); }

  const totalQty = allocs.reduce((s, a) => s + Number(a.qty || 0), 0);
  const remaining = (header?.qty ?? 0) - totalQty;

  async function save() {
    if (!header) return;
    setError(null);
    if (Math.abs(remaining) > 0.0001 && remaining < 0) {
      setError(`Total qty (${totalQty}) exceeds bill line qty (${header.qty})`);
      return;
    }
    if (allocs.length === 0) {
      setError("At least one allocation required");
      return;
    }
    for (const a of allocs) {
      if (a.targetType === "INVOICE" && !a.invoiceNumber.trim()) {
        setError("INVOICE allocations need an invoice number");
        return;
      }
      if (!Number.isFinite(a.qty) || a.qty <= 0) {
        setError("Each allocation needs a positive qty");
        return;
      }
    }
    setBusy(true);
    const r = await fetch(`/api/zoho-recon/bill-line/${billLineId}/splits`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allocations: allocs.map((a) => ({
          targetType: a.targetType,
          qty: a.qty,
          invoiceNumber: a.invoiceNumber.trim() || undefined,
          targetCustomerName: a.targetCustomerName.trim() || undefined,
          targetSiteName: a.targetSiteName.trim() || undefined,
          targetTicketRef: a.targetTicketRef.trim() || undefined,
          note: a.note.trim() || undefined,
        })),
      }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) { setError(j.error || `HTTP ${r.status}`); return; }
    onSaved();
    onClose();
  }

  async function clear() {
    if (!confirm("Remove ALL allocations on this bill line?")) return;
    setBusy(true);
    await fetch(`/api/zoho-recon/bill-line/${billLineId}/splits`, { method: "DELETE" });
    setBusy(false);
    onSaved();
    onClose();
  }

  if (!header) {
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
        <div className="text-[#888888] bb-mono text-[11px]">{error || "Loading…"}</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-[#0D0D0D] border border-[#FF6600] max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-[#1A1A1A] border-b border-[#333333] px-4 py-3">
          <div className="text-[#FF6600] tracking-widest bb-mono text-sm">SPLIT BILL LINE</div>
          <div className="text-[#CCCCCC] bb-mono text-[11px] mt-1">
            {header.vendor} · {header.billNo} · {header.description.slice(0, 80)}
          </div>
          <div className="text-[#888888] bb-mono text-[10px] mt-1">
            Bill qty: <span className="text-[#CCCCCC]">{header.qty}</span> &nbsp;
            Total cost: <span className="text-[#CCCCCC]">£{header.cost.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span> &nbsp;
            Site: <span className="text-[#CCCCCC]">{header.cfSite || "—"}</span> &nbsp;
            Cust: <span className="text-[#CCCCCC]">{header.customerName || "—"}</span>
          </div>
        </div>

        {/* Allocation rows */}
        <div className="p-4 space-y-2">
          <div className="grid grid-cols-12 gap-2 text-[10px] tracking-widest text-[#888888] bb-mono uppercase border-b border-[#333333] pb-1">
            <div className="col-span-2">Type</div>
            <div className="col-span-1">Qty</div>
            <div className="col-span-3">Invoice / Target</div>
            <div className="col-span-2">Customer</div>
            <div className="col-span-2">Site</div>
            <div className="col-span-1">Note</div>
            <div className="col-span-1"></div>
          </div>
          {allocs.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 text-[11px] bb-mono items-center">
              <select
                value={a.targetType}
                onChange={(e) => update(i, { targetType: e.target.value as Allocation["targetType"] })}
                className="col-span-2 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1.5 py-1"
                style={{ color: TARGET_COLOUR[a.targetType] }}
              >
                <option value="INVOICE">INVOICE</option>
                <option value="STOCK">STOCK</option>
                <option value="TICKET">TICKET</option>
                <option value="PENDING">PENDING</option>
                <option value="WRITE_OFF">WRITE_OFF</option>
              </select>
              <input
                type="number"
                step="any"
                value={a.qty}
                onChange={(e) => update(i, { qty: Number(e.target.value) || 0 })}
                className="col-span-1 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] px-1.5 py-1 text-right"
              />
              <input
                placeholder={a.targetType === "INVOICE" ? "INV-004842" : a.targetType === "TICKET" ? "Ticket #" : "—"}
                value={a.targetType === "INVOICE" ? a.invoiceNumber : a.targetType === "TICKET" ? a.targetTicketRef : ""}
                onChange={(e) => update(i, a.targetType === "INVOICE" ? { invoiceNumber: e.target.value } : { targetTicketRef: e.target.value })}
                disabled={a.targetType === "WRITE_OFF" || a.targetType === "STOCK" || a.targetType === "PENDING"}
                className="col-span-3 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] px-1.5 py-1 disabled:opacity-30"
              />
              <input
                placeholder="customer"
                value={a.targetCustomerName}
                onChange={(e) => update(i, { targetCustomerName: e.target.value })}
                className="col-span-2 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] px-1.5 py-1"
              />
              <input
                placeholder="site"
                value={a.targetSiteName}
                onChange={(e) => update(i, { targetSiteName: e.target.value })}
                className="col-span-2 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] px-1.5 py-1"
              />
              <input
                placeholder="note"
                value={a.note}
                onChange={(e) => update(i, { note: e.target.value })}
                className="col-span-1 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] px-1.5 py-1"
              />
              <button
                onClick={() => removeRow(i)}
                disabled={allocs.length <= 1}
                className="col-span-1 text-[#FF3333] text-[10px] hover:underline disabled:opacity-30"
              >
                ✕ remove
              </button>
            </div>
          ))}

          <button
            onClick={addRow}
            className="text-[10px] tracking-widest text-[#00CC66] hover:underline mt-2"
          >
            + ADD ALLOCATION
          </button>
        </div>

        {/* Totals + actions */}
        <div className="bg-[#1A1A1A] border-t border-[#333333] px-4 py-3 flex items-center gap-4 text-[11px] bb-mono">
          <div>
            <span className="text-[#888888]">ALLOCATED</span>{" "}
            <span className={remaining === 0 ? "text-[#00CC66]" : Math.abs(remaining) < 0.0001 ? "text-[#00CC66]" : remaining < 0 ? "text-[#FF3333]" : "text-[#FFCC00]"}>
              {totalQty} of {header.qty}
            </span>
          </div>
          <div>
            <span className="text-[#888888]">REMAINING</span>{" "}
            <span className={remaining < 0 ? "text-[#FF3333]" : remaining > 0 ? "text-[#FFCC00]" : "text-[#00CC66]"}>
              {remaining}
            </span>
          </div>
          {error && <div className="text-[#FF3333] flex-1">{error}</div>}
          <div className="ml-auto flex gap-2">
            <button onClick={clear} disabled={busy} className="border border-[#FF3333] text-[#FF3333] px-3 py-1 text-[10px] tracking-widest hover:bg-[#FF3333] hover:text-black disabled:opacity-30">
              CLEAR ALL
            </button>
            <button onClick={onClose} disabled={busy} className="border border-[#333333] text-[#888888] px-3 py-1 text-[10px] tracking-widest hover:text-[#CCCCCC]">
              CANCEL
            </button>
            <button onClick={save} disabled={busy} className="border border-[#FF6600] text-[#FF6600] px-3 py-1 text-[10px] tracking-widest hover:bg-[#FF6600] hover:text-black disabled:opacity-30">
              {busy ? "SAVING…" : "SAVE"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

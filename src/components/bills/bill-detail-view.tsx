"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LineCustomerSwap } from "./line-customer-swap";

type Allocation = {
  id: string;
  allocationType: "TICKET_LINE" | "STOCK" | "RETURNS_CANDIDATE" | "OVERHEAD" | "UNRESOLVED";
  ticketLineId: string | null;
  ticketId: string | null;
  siteId: string | null;
  customerId: string | null;
  qtyAllocated: string | number;
  costAllocated: string | number;
  reason: string | null;
  costAllocationId: string | null;
  returnId: string | null;
  stockExcessRecordId: string | null;
  absorbedAllocationId: string | null;
};

type BillLine = {
  id: string;
  description: string;
  productCode: string | null;
  qty: string | number;
  unitCost: string | number;
  lineTotal: string | number;
  allocationStatus: "MATCHED" | "PARTIAL" | "SUGGESTED" | "EXCEPTION" | "UNALLOCATED";
  ticket: { id: string; ticketNo?: string | null } | null;
  site: { id: string; siteName: string } | null;
  customer: { id: string; name: string } | null;
  billLineAllocations: Allocation[];
};

type Bill = {
  id: string;
  billNo: string;
  billDate: string;
  status: string;
  totalCost: string | number;
  customerRef: string | null;
  siteRef: string | null;
  supplier: { id: string; name: string };
  lines: BillLine[];
};

function fmt(n: string | number | null | undefined): string {
  if (n == null) return "—";
  const v = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const ALLOC_COLOUR: Record<Allocation["allocationType"], string> = {
  TICKET_LINE:       "#00CC66",
  STOCK:             "#3399FF",
  RETURNS_CANDIDATE: "#FF9900",
  OVERHEAD:          "#999999",
  UNRESOLVED:        "#FF3333",
};

export function BillDetailView({ billId }: { billId: string }) {
  const [bill, setBill] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [reassignFor, setReassignFor] = useState<string | null>(null);
  const [ticketInput, setTicketInput] = useState("");
  const [splitInput, setSplitInput] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/supplier-bills/${billId}`);
    const data = await r.json();
    if (data?.id) setBill(data);
  }, [billId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function postJson(url: string, body: unknown, method: "POST" | "PUT" = "POST") {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || `HTTP ${r.status}`);
        return null;
      }
      await refresh();
      return j;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function moveLineTo(line: BillLine, type: Allocation["allocationType"], extra: Partial<Allocation> = {}) {
    return postJson(
      `/api/supplier-bills/${billId}/lines/${line.id}/allocations`,
      {
        allocations: [
          {
            type,
            qty: Number(line.qty),
            ticketId: extra.ticketId ?? null,
            ticketLineId: extra.ticketLineId ?? null,
            siteId: extra.siteId ?? null,
            customerId: extra.customerId ?? null,
            reason: `Manual: ${type}`,
          },
        ],
      },
      "PUT"
    );
  }

  async function splitLine(line: BillLine) {
    const qty = Number(splitInput);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Split qty must be a positive number");
      return;
    }
    if (qty >= Number(line.qty)) {
      setError(`Split qty must be less than ${Number(line.qty)}`);
      return;
    }
    setSplitFor(null);
    setSplitInput("");
    await postJson(`/api/supplier-bills/${billId}/lines/${line.id}/split`, { qty });
  }

  async function reallocate(line: BillLine) {
    await postJson(`/api/supplier-bills/${billId}/lines/${line.id}/reallocate`, {});
  }

  async function reassignToTicket(line: BillLine) {
    const ticketId = ticketInput.trim();
    if (!ticketId) {
      setError("Ticket ID required");
      return;
    }
    setReassignFor(null);
    setTicketInput("");
    await moveLineTo(line, "TICKET_LINE", { ticketId });
  }

  const totals = useMemo(() => {
    if (!bill) return null;
    const sum = bill.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    return { sum };
  }, [bill]);

  if (!bill) return <div className="text-[11px] text-[#888888] bb-mono">Loading…</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-[#333333] pb-3">
        <div>
          <Link href="/bills" className="text-[10px] tracking-widest text-[#888888] bb-mono hover:text-[#FF6600]">
            ← BILLS
          </Link>
          <div className="mt-1 text-sm tracking-[0.3em] uppercase bb-mono text-[#FF6600]">
            {bill.supplier.name} · {bill.billNo}
          </div>
          <div className="text-[11px] text-[#888888] bb-mono mt-1">
            {new Date(bill.billDate).toLocaleDateString("en-GB")}
            {bill.customerRef && <span className="ml-3">CUST REF: {bill.customerRef}</span>}
            {bill.siteRef && <span className="ml-3">SITE REF: {bill.siteRef}</span>}
          </div>
        </div>
        <div className="text-right bb-mono">
          <div className="text-[10px] tracking-widest text-[#888888]">STATUS</div>
          <div className="text-[11px] text-[#FF6600]">{bill.status}</div>
          <div className="text-[10px] tracking-widest text-[#888888] mt-2">TOTAL</div>
          <div className="text-sm text-[#CCCCCC]">£ {fmt(bill.totalCost)}</div>
          {totals && Math.abs(totals.sum - Number(bill.totalCost)) > 0.01 && (
            <div className="text-[10px] text-[#FF9900] mt-1">Lines sum: £{fmt(totals.sum)}</div>
          )}
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-[#FF3333] bb-mono border border-[#FF3333] px-3 py-2">
          {error}
        </div>
      )}

      {/* Lines table */}
      <div className="border border-[#2A2A2A]">
        <table className="w-full text-[11px] bb-mono">
          <thead className="bg-[#1A1A1A] text-[#888888] uppercase tracking-widest">
            <tr>
              <th className="text-left px-3 py-2 w-[40%]">Description</th>
              <th className="text-right px-3 py-2">Qty</th>
              <th className="text-right px-3 py-2">Unit</th>
              <th className="text-right px-3 py-2">Total</th>
              <th className="text-left px-3 py-2">Allocation</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => {
              const lineAllocs = l.billLineAllocations || [];
              const posted = lineAllocs.some(
                (a) => a.costAllocationId || a.returnId || a.stockExcessRecordId || a.absorbedAllocationId
              );

              return (
                <tr key={l.id} className="border-t border-[#222222] align-top">
                  <td className="px-3 py-2 text-[#CCCCCC]">
                    <div>{l.description}</div>
                    {l.productCode && (
                      <div className="text-[10px] text-[#666666] mt-0.5">{l.productCode}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-[#CCCCCC]">{fmt(l.qty)}</td>
                  <td className="px-3 py-2 text-right text-[#CCCCCC]">{fmt(l.unitCost)}</td>
                  <td className="px-3 py-2 text-right text-[#CCCCCC]">{fmt(l.lineTotal)}</td>
                  <td className="px-3 py-2">
                    {lineAllocs.length === 0 ? (
                      <span className="text-[#666666]">{l.allocationStatus}</span>
                    ) : (
                      <div className="space-y-0.5">
                        {lineAllocs.map((a) => (
                          <div key={a.id} className="text-[10px]">
                            <span style={{ color: ALLOC_COLOUR[a.allocationType] }}>{a.allocationType}</span>
                            <span className="text-[#888888]"> · {fmt(a.qtyAllocated)} @ £{fmt(a.costAllocated)}</span>
                            {a.ticketId && <span className="text-[#666666]"> · t:{a.ticketId.slice(0, 8)}</span>}
                            {(a.costAllocationId || a.returnId || a.stockExcessRecordId || a.absorbedAllocationId) && (
                              <span className="text-[#00CC66]"> · POSTED</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {posted ? (
                      <span className="text-[10px] text-[#666666]">posted — locked</span>
                    ) : splitFor === l.id ? (
                      <div className="flex justify-end gap-1">
                        <input
                          autoFocus
                          value={splitInput}
                          onChange={(e) => setSplitInput(e.target.value)}
                          placeholder="qty"
                          className="w-14 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-0.5"
                        />
                        <button
                          onClick={() => splitLine(l)}
                          disabled={busy}
                          className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
                        >
                          OK
                        </button>
                        <button
                          onClick={() => { setSplitFor(null); setSplitInput(""); }}
                          className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
                        >
                          ✕
                        </button>
                      </div>
                    ) : reassignFor === l.id ? (
                      <div className="flex justify-end gap-1">
                        <input
                          autoFocus
                          value={ticketInput}
                          onChange={(e) => setTicketInput(e.target.value)}
                          placeholder="ticket id"
                          className="w-32 bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-0.5"
                        />
                        <button
                          onClick={() => reassignToTicket(l)}
                          disabled={busy}
                          className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
                        >
                          OK
                        </button>
                        <button
                          onClick={() => { setReassignFor(null); setTicketInput(""); }}
                          className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2 text-[10px] bb-mono">
                        <button
                          onClick={() => setSplitFor(l.id)}
                          disabled={busy}
                          className="text-[#CCCCCC] hover:text-[#FF6600] disabled:opacity-50"
                        >
                          SPLIT
                        </button>
                        <button
                          onClick={() => moveLineTo(l, "STOCK")}
                          disabled={busy}
                          className="text-[#3399FF] hover:underline disabled:opacity-50"
                        >
                          → STOCK
                        </button>
                        <button
                          onClick={() => moveLineTo(l, "RETURNS_CANDIDATE")}
                          disabled={busy}
                          className="text-[#FF9900] hover:underline disabled:opacity-50"
                        >
                          → RETURN
                        </button>
                        <button
                          onClick={() => setReassignFor(l.id)}
                          disabled={busy}
                          className="text-[#00CC66] hover:underline disabled:opacity-50"
                        >
                          → TICKET
                        </button>
                        <button
                          onClick={() => reallocate(l)}
                          disabled={busy}
                          className="text-[#888888] hover:text-[#FF6600] disabled:opacity-50"
                        >
                          AUTO
                        </button>
                        <LineCustomerSwap
                          billId={billId}
                          lineId={l.id}
                          currentCustomer={l.customer}
                          disabled={busy}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

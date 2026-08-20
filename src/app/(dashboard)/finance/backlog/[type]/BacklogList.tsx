"use client";

import { useEffect, useState } from "react";

type Type = "bills" | "invoices" | "payments" | "contacts";
type Row = Record<string, unknown>;
type Option = { id: string; name: string };

type InvoiceLine = {
  lineNumber: number;
  itemName: string | null;
  itemDesc: string | null;
  productId: string | null;
  sku: string | null;
  quantity: number | null;
  usageUnit: string | null;
  itemPrice: number | null;
  itemTotal: number | null;
  account: string | null;
  accountCode: string | null;
  itemTaxPercent: number | null;
  itemTaxAmount: number | null;
  cfSite: string | null;
};

type InvoiceDetails = { payload: unknown; lines: InvoiceLine[] };

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function BacklogList({
  type,
  rows,
  customers,
  suppliers,
}: {
  type: Type;
  rows: Row[];
  customers: Option[];
  suppliers: Option[];
}) {
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [details, setDetails] = useState<InvoiceDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const cols = colsFor(type);

  useEffect(() => {
    if (!selected) {
      setDetails(null);
      return;
    }
    if (type !== "invoices") return;
    setLoadingDetails(true);
    setDetails(null);
    fetch(`/api/finance/backlog/invoices/${selected.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: InvoiceDetails) => setDetails(d))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load lines"))
      .finally(() => setLoadingDetails(false));
  }, [selected, type]);

  async function callAction(body: Record<string, unknown>) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/backlog/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Action failed");
      window.location.reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Action failed");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              {cols.map((c) => (
                <th key={c.key} className={`text-${c.align ?? "left"} px-3 py-2 font-semibold`}>
                  {c.label}
                </th>
              ))}
              <th className="text-right px-3 py-2 font-semibold w-20">—</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={cols.length + 1} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  — empty —
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id as string}
                className="border-b border-[#222222] hover:bg-[#222222] cursor-pointer"
                onClick={() => setSelected(r)}
              >
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 text-xs text-[#E0E0E0] text-${c.align ?? "left"} ${
                      c.tabular ? "tabular-nums" : ""
                    }`}
                  >
                    {c.render
                      ? c.render(r[c.key])
                      : (r[c.key] as React.ReactNode) ?? "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-[10px] text-[#888888]">view</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6"
          onClick={() => !busy && setSelected(null)}
        >
          <div
            className="bg-[#1A1A1A] border border-[#333333] w-full max-w-3xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[#333333] px-4 py-3 flex items-baseline justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#888888]">
                  {type.toUpperCase()} · {String(selected.importStatus)}
                </div>
                <div className="text-sm text-[#E0E0E0] mt-1">
                  {primaryLabel(type, selected)}
                </div>
              </div>
            </div>

            {err && (
              <div className="px-4 py-2 bg-[#3A0000] border-b border-[#FF3333] text-[11px] text-[#FF6666]">
                {err}
              </div>
            )}

            {/* Action bar */}
            {String(selected.importStatus) === "QUARANTINED" && (
              <div className="border-b border-[#333333] p-4 space-y-3">
                {type === "bills" && (
                  <PromoteBillForm
                    suppliers={suppliers}
                    onSubmit={(supplierId) =>
                      callAction({
                        type: "BILL",
                        action: "PROMOTE",
                        stagingId: selected.id,
                        supplierId,
                      })
                    }
                    busy={busy}
                  />
                )}
                {type === "contacts" && (
                  <PromoteContactForm
                    onSubmit={(asKind) =>
                      callAction({
                        type: "CONTACT",
                        action: "PROMOTE",
                        stagingId: selected.id,
                        asKind,
                      })
                    }
                    busy={busy}
                  />
                )}
                {(type === "invoices" || type === "payments") && (
                  <div className="text-[11px] text-[#888888]">
                    Promotion for {type} requires linking to a Customer / Site / Ticket /
                    SalesInvoice / SupplierBill. Use the API directly until the picker
                    UI ships.
                  </div>
                )}

                <RejectBar
                  onReject={(reason) =>
                    callAction({
                      type: typeApiName(type),
                      action: "REJECT",
                      stagingId: selected.id,
                      reason,
                    })
                  }
                  busy={busy}
                />
              </div>
            )}

            {/* Line items (invoices only) */}
            {type === "invoices" && (
              <div className="p-4 border-b border-[#333333]">
                <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-2">
                  LINE ITEMS{details ? ` · ${details.lines.length}` : ""}
                </div>
                {loadingDetails && (
                  <div className="text-[11px] text-[#666666]">Loading lines…</div>
                )}
                {details && details.lines.length === 0 && (
                  <div className="text-[11px] text-[#666666]">— no lines —</div>
                )}
                {details && details.lines.length > 0 && (
                  <div className="border border-[#333333] bg-[#0A0A0A] overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead>
                        <tr className="border-b border-[#333333] text-[#888888] uppercase tracking-widest">
                          <th className="text-right px-2 py-1.5 w-8">#</th>
                          <th className="text-left  px-2 py-1.5">Item / Description</th>
                          <th className="text-left  px-2 py-1.5 w-32">Site</th>
                          <th className="text-right px-2 py-1.5 w-16 tabular-nums">Qty</th>
                          <th className="text-left  px-2 py-1.5 w-12">Unit</th>
                          <th className="text-right px-2 py-1.5 w-24 tabular-nums">Price</th>
                          <th className="text-right px-2 py-1.5 w-24 tabular-nums">Total</th>
                          <th className="text-right px-2 py-1.5 w-14 tabular-nums">Tax%</th>
                          <th className="text-right px-2 py-1.5 w-20 tabular-nums">Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details.lines.map((l) => (
                          <tr key={l.lineNumber} className="border-b border-[#1F1F1F] text-[#E0E0E0]">
                            <td className="px-2 py-1.5 text-right text-[#666666]">{l.lineNumber}</td>
                            <td className="px-2 py-1.5">
                              <div>{l.itemDesc || l.itemName || "—"}</div>
                              {l.sku && (
                                <div className="text-[9px] text-[#666666]">SKU: {l.sku}</div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-[#888888]">{l.cfSite ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity ?? "—"}</td>
                            <td className="px-2 py-1.5 text-[#888888]">{l.usageUnit ?? "—"}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {l.itemPrice != null ? `£${fmt(l.itemPrice)}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {l.itemTotal != null ? `£${fmt(l.itemTotal)}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[#888888]">
                              {l.itemTaxPercent != null ? `${l.itemTaxPercent}%` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {l.itemTaxAmount != null ? `£${fmt(l.itemTaxAmount)}` : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Raw payload */}
            <div className="p-4">
              <div className="text-[10px] uppercase tracking-widest text-[#888888] mb-2">
                ZOHO PAYLOAD
              </div>
              <pre className="text-[10px] text-[#E0E0E0] bg-[#0A0A0A] border border-[#333333] p-3 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(
                  type === "invoices" ? details?.payload : selected.payload,
                  null,
                  2
                )}
              </pre>
            </div>

            <div className="border-t border-[#333333] px-4 py-2 flex justify-end">
              <button
                onClick={() => setSelected(null)}
                disabled={busy}
                className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#E0E0E0]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PromoteBillForm({
  suppliers,
  onSubmit,
  busy,
}: {
  suppliers: Option[];
  onSubmit: (supplierId: string) => void;
  busy: boolean;
}) {
  const [supplierId, setSupplierId] = useState("");
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-[#00CC66] font-bold">
        PROMOTE TO SUPPLIER BILL
      </div>
      <select
        value={supplierId}
        onChange={(e) => setSupplierId(e.target.value)}
        className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
      >
        <option value="">— pick supplier —</option>
        {suppliers.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => supplierId && onSubmit(supplierId)}
        disabled={!supplierId || busy}
        className="bg-[#00CC66] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30"
      >
        Promote → Post AP entry
      </button>
    </div>
  );
}

function PromoteContactForm({
  onSubmit,
  busy,
}: {
  onSubmit: (asKind: "CUSTOMER" | "SUPPLIER") => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-[#00CC66] font-bold">
        PROMOTE AS
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit("CUSTOMER")}
          disabled={busy}
          className="flex-1 bg-[#00CC66] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30"
        >
          New Customer
        </button>
        <button
          onClick={() => onSubmit("SUPPLIER")}
          disabled={busy}
          className="flex-1 bg-[#00CC66] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30"
        >
          New Supplier
        </button>
      </div>
    </div>
  );
}

function RejectBar({ onReject, busy }: { onReject: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-[#FF3333] font-bold">
        REJECT
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (e.g. duplicate / test / wrong company)"
        className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-2"
      />
      <button
        onClick={() => reason && onReject(reason)}
        disabled={!reason || busy}
        className="bg-[#FF3333] text-black text-[10px] uppercase tracking-widest font-bold px-3 py-2 disabled:opacity-30"
      >
        Reject
      </button>
    </div>
  );
}

function typeApiName(type: Type): "BILL" | "INVOICE" | "PAYMENT" | "CONTACT" {
  if (type === "bills") return "BILL";
  if (type === "invoices") return "INVOICE";
  if (type === "payments") return "PAYMENT";
  return "CONTACT";
}

function primaryLabel(type: Type, r: Row): string {
  if (type === "bills") return `${r.zohoNumber ?? "(no #)"} — ${r.vendorName ?? "?"}`;
  if (type === "invoices") return `${r.zohoNumber ?? "(no #)"} — ${r.customerName ?? "?"}`;
  if (type === "payments")
    return `${r.paymentSide} payment — ${r.contactName ?? "?"} — ${r.reference ?? ""}`;
  return `${r.companyName ?? r.contactName ?? "?"} (${r.contactType ?? "—"})`;
}

interface Col {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  tabular?: boolean;
  render?: (v: unknown) => React.ReactNode;
}

function colsFor(type: Type): Col[] {
  if (type === "bills")
    return [
      { key: "billDate", label: "Date", tabular: true },
      { key: "zohoNumber", label: "Bill #" },
      { key: "vendorName", label: "Vendor" },
      { key: "status", label: "Status" },
      {
        key: "total",
        label: "Total",
        align: "right",
        tabular: true,
        render: (v) => (v != null ? `£${fmt(v as number)}` : "—"),
      },
    ];
  if (type === "invoices")
    return [
      { key: "invoiceDate", label: "Date", tabular: true },
      { key: "dueDate", label: "Due", tabular: true },
      { key: "zohoNumber", label: "Invoice #" },
      { key: "customerName", label: "Customer" },
      { key: "status", label: "Status" },
      {
        key: "lineCount",
        label: "Lines",
        align: "right",
        tabular: true,
        render: (v) => (v != null ? String(v) : "—"),
      },
      {
        key: "total",
        label: "Total",
        align: "right",
        tabular: true,
        render: (v) => (v != null ? `£${fmt(v as number)}` : "—"),
      },
      {
        key: "balance",
        label: "Balance",
        align: "right",
        tabular: true,
        render: (v) => (v != null ? `£${fmt(v as number)}` : "—"),
      },
    ];
  if (type === "payments")
    return [
      { key: "paymentDate", label: "Date", tabular: true },
      { key: "paymentSide", label: "Side" },
      { key: "contactName", label: "Counterparty" },
      { key: "paymentMode", label: "Method" },
      { key: "reference", label: "Ref" },
      {
        key: "amount",
        label: "Amount",
        align: "right",
        tabular: true,
        render: (v) => (v != null ? `£${fmt(v as number)}` : "—"),
      },
    ];
  return [
    { key: "contactName", label: "Contact" },
    { key: "companyName", label: "Company" },
    { key: "contactType", label: "Type" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "vatNumber", label: "VAT" },
  ];
}

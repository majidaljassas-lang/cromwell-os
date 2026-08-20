"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Line = {
  id: string;
  description: string;
  requestedQty: number;
  deliveredQty: number;
  invoicedQty: number;
  backorderQty: number;     // requested − delivered (still owed to deliver)
  invoiceableQty: number;   // delivered − invoiced (ready to bill)
  unitPrice: number;
  displayOrder: number;
};

type InvoiceRow = {
  id: string;
  invoiceNo: string | null;
  status: string;
  totalSell: number;
  issuedAt: string | null;
};

function gbp(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CallOffDetail({
  callOffId,
  status,
  lines,
  invoices,
}: {
  callOffId: string;
  status: string;
  lines: Line[];
  invoices: InvoiceRow[];
}) {
  const router = useRouter();
  const canInvoice = status !== "COMPLETED" && status !== "CANCELLED";
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTotal = useMemo(() => {
    let t = 0;
    for (const l of lines) {
      const v = Number(qty[l.id] ?? 0);
      if (!Number.isFinite(v) || v <= 0) continue;
      t += Math.min(v, l.invoiceableQty) * l.unitPrice;
    }
    return Number(t.toFixed(2));
  }, [qty, lines]);

  const anyOver = lines.some((l) => {
    const v = Number(qty[l.id] ?? 0);
    return Number.isFinite(v) && v > l.invoiceableQty + 1e-6;
  });

  function fillAll() {
    const next: Record<string, string> = {};
    for (const l of lines) if (l.invoiceableQty > 0) next[l.id] = String(l.invoiceableQty);
    setQty(next);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payloadLines = lines
        .map((l) => {
          const v = Number(qty[l.id] ?? 0);
          if (!Number.isFinite(v) || v <= 0) return null;
          return { callOffLineId: l.id, qty: v };
        })
        .filter((x): x is { callOffLineId: string; qty: number } => x !== null);
      if (payloadLines.length === 0) {
        setError("Enter a qty on at least one line");
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/call-offs/${callOffId}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: payloadLines, invoiceStatus: "DRAFT" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invoice failed");
        setBusy(false);
        return;
      }
      router.push(`/invoices/${data.invoiceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-2 w-10">#</th>
              <th className="text-left p-2">Description</th>
              <th className="text-right p-2">Unit £</th>
              <th className="text-right p-2">Requested</th>
              <th className="text-right p-2">Delivered</th>
              <th className="text-right p-2">Invoiced</th>
              <th className="text-right p-2">Open back-order</th>
              {canInvoice && <th className="p-2 w-32">Invoice qty</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {lines.map((l) => {
              const v = Number(qty[l.id] ?? 0);
              const over = Number.isFinite(v) && v > l.invoiceableQty + 1e-6;
              return (
                <tr key={l.id} className={over ? "bg-[#FF3333]/10" : undefined}>
                  <td className="p-2 text-muted-foreground">{l.displayOrder}</td>
                  <td className="p-2">{l.description}</td>
                  <td className="p-2 text-right tabular-nums">£{l.unitPrice.toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums">{l.requestedQty}</td>
                  <td className="p-2 text-right tabular-nums">
                    {l.deliveredQty > 0 ? l.deliveredQty : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 text-right tabular-nums">{l.invoicedQty}</td>
                  <td className="p-2 text-right tabular-nums">
                    {l.backorderQty > 0 ? (
                      <strong className="text-[#FF9900]">{l.backorderQty}</strong>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {canInvoice && (
                    <td className="p-2">
                      <Input
                        type="number"
                        min="0"
                        max={l.invoiceableQty}
                        step="any"
                        value={qty[l.id] ?? ""}
                        onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })}
                        className="h-7 text-xs"
                        disabled={l.invoiceableQty <= 0}
                        title={
                          l.invoiceableQty <= 0
                            ? "Nothing invoiceable — record delivery first via a Delivery Note"
                            : `Max ${l.invoiceableQty} (delivered − already invoiced)`
                        }
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canInvoice && (
        <div className="rounded border p-3 space-y-2">
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              className="underline text-muted-foreground"
              onClick={fillAll}
              disabled={lines.every((l) => l.invoiceableQty <= 0)}
            >
              Fill invoiceable qty
            </button>
            <div className="ml-auto">
              <span className="text-muted-foreground">This invoice: </span>
              <strong>{gbp(selectedTotal)}</strong>
            </div>
          </div>
          {anyOver && (
            <p className="text-xs text-[#FF3333]">
              One or more lines exceed invoiceable qty (delivered − already invoiced).
            </p>
          )}
          {lines.every((l) => l.invoiceableQty <= 0) && (
            <p className="text-xs text-muted-foreground">
              Nothing invoiceable yet — record a Delivery Note first to register actual delivered qty.
            </p>
          )}
          {error && <p className="text-xs text-[#FF3333]">{error}</p>}
          <Button
            onClick={submit}
            disabled={busy || anyOver || selectedTotal <= 0}
            className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
          >
            {busy ? "Creating…" : "Invoice delivered qty"}
          </Button>
        </div>
      )}

      <div className="rounded border">
        <div className="bg-muted/40 px-3 py-2 text-xs font-medium">Invoices on this call-off</div>
        {invoices.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No invoices yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="p-2">Invoice</th>
                <th className="p-2">Status</th>
                <th className="p-2">Issued</th>
                <th className="p-2 text-right">Total £</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="p-2">
                    <Link href={`/invoices/${i.id}`} className="underline">
                      {i.invoiceNo ?? i.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-2">{i.status}</td>
                  <td className="p-2">
                    {i.issuedAt ? new Date(i.issuedAt).toLocaleDateString("en-GB") : "—"}
                  </td>
                  <td className="p-2 text-right tabular-nums">{gbp(i.totalSell)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

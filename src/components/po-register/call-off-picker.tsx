"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = {
  poLineId: string;
  ticketLineId: string | null;
  description: string;
  productCode: string | null;
  unit: string;
  unitPrice: number;
  orderedQty: number;
  orderedValue: number;
  consumedQty: number;
  consumedValue: number;
  remainingQty: number;
  remainingValue: number;
  sub: string[] | null;
};

function gbp(n: number) {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CallOffPicker({
  poId,
  poRemaining,
  rows,
}: {
  poId: string;
  poRemaining: number;
  rows: Row[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [hideFull, setHideFull] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (hideFull && r.remainingQty <= 0) return false;
      if (!f) return true;
      return (
        r.description.toLowerCase().includes(f) ||
        (r.productCode ?? "").toLowerCase().includes(f)
      );
    });
  }, [rows, filter, hideFull]);

  const selectedRequested = useMemo(() => {
    let total = 0;
    for (const r of rows) {
      const raw = picked[r.poLineId];
      if (!raw) continue;
      const q = Number(raw);
      if (!Number.isFinite(q) || q <= 0) continue;
      total += q * r.unitPrice;
    }
    return Number(total.toFixed(2));
  }, [picked, rows]);

  const overPo = selectedRequested > poRemaining + 1e-6;

  const overLineIds = useMemo(() => {
    const out: string[] = [];
    for (const r of rows) {
      const raw = picked[r.poLineId];
      if (!raw) continue;
      const q = Number(raw);
      if (!Number.isFinite(q) || q <= 0) continue;
      if (q > r.remainingQty + 1e-6) out.push(r.poLineId);
    }
    return out;
  }, [picked, rows]);

  function setQty(id: string, value: string) {
    setPicked((p) => ({ ...p, [id]: value }));
  }
  function fillRemaining(r: Row) {
    setPicked((p) => ({ ...p, [r.poLineId]: String(r.remainingQty) }));
  }
  function clearAll() {
    setPicked({});
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const lines = rows
        .map((r) => {
          const raw = picked[r.poLineId];
          if (!raw || !r.ticketLineId) return null;
          const qty = Number(raw);
          if (!Number.isFinite(qty) || qty <= 0) return null;
          return { ticketLineId: r.ticketLineId, qty, unitPrice: r.unitPrice };
        })
        .filter((x): x is { ticketLineId: string; qty: number; unitPrice: number } => x !== null);

      if (lines.length === 0) {
        setError("Pick at least one line with a quantity");
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/customer-pos/${poId}/call-offs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callOffDate: new Date().toISOString().slice(0, 10),
          source: "Picker UI",
          lines,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Call-off failed");
        if (data.overQty)
          setError(
            (data.error || "Over-line qty") +
              ": " +
              data.overQty
                .map((o: { description: string; requested: number; remaining: number }) =>
                  `${o.description.slice(0, 40)} requested ${o.requested}, only ${o.remaining} remaining`
                )
                .join("; ")
          );
        setBusy(false);
        return;
      }
      if (data.callOffId) {
        router.push(`/call-offs/${data.callOffId}`);
      } else {
        router.push(`/po-register?highlight=${poId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs">
        <Input
          placeholder="Filter by description / code…"
          className="h-8 text-xs max-w-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hideFull}
            onChange={(e) => setHideFull(e.target.checked)}
          />
          Hide fully called-off
        </label>
        <span className="text-muted-foreground ml-auto">
          {filtered.length} / {rows.length} lines
        </span>
      </div>

      <div className="rounded border max-h-[60vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[36%]">Description</TableHead>
              <TableHead className="text-right">Unit £</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Called off</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-44">This call-off qty</TableHead>
              <TableHead className="text-right">£ this call-off</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const raw = picked[r.poLineId] ?? "";
              const q = Number(raw);
              const valid = Number.isFinite(q) && q > 0;
              const overLine = valid && q > r.remainingQty + 1e-6;
              const lineTotal = valid ? q * r.unitPrice : 0;
              return (
                <TableRow key={r.poLineId} className={overLine ? "bg-[#FF3333]/10" : undefined}>
                  <TableCell className="text-xs">
                    {r.description}
                    {r.productCode && (
                      <span className="text-[10px] text-muted-foreground ml-1">
                        ({r.productCode})
                      </span>
                    )}
                    {r.sub?.map((l, i) => (
                      <div key={i} className="text-[10px] text-[#A855F7] mt-0.5 font-medium">{l}</div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    £{r.unitPrice.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {r.orderedQty} {r.unit}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                    {r.consumedQty}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    <strong>{r.remainingQty}</strong>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={raw}
                        onChange={(e) => setQty(r.poLineId, e.target.value)}
                        className="h-7 text-xs w-24"
                        disabled={r.remainingQty <= 0}
                      />
                      <button
                        type="button"
                        className="text-[10px] underline text-muted-foreground"
                        onClick={() => fillRemaining(r)}
                        disabled={r.remainingQty <= 0}
                      >
                        all
                      </button>
                    </div>
                    {overLine && (
                      <p className="text-[10px] text-[#FF3333]">over remaining qty</p>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {valid ? gbp(lineTotal) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div
        className={`rounded border p-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs ${
          overPo ? "border-[#FF3333]/50 bg-[#FF3333]/10" : ""
        }`}
      >
        <div>
          <span className="text-muted-foreground">Call-off total: </span>
          <strong>{gbp(selectedRequested)}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">PO remaining: </span>
          {gbp(poRemaining)}
        </div>
        <div>
          <span className="text-muted-foreground">After this call-off: </span>
          <strong className={overPo ? "text-[#FF3333]" : undefined}>
            {gbp(poRemaining - selectedRequested)}
          </strong>
        </div>
        <button
          type="button"
          className="ml-auto text-muted-foreground underline"
          onClick={clearAll}
        >
          Clear all
        </button>
      </div>

      {overPo && (
        <p className="text-xs text-[#FF3333]">
          Call-off total exceeds PO remaining by {gbp(selectedRequested - poRemaining)} — adjust before
          submitting.
        </p>
      )}
      {overLineIds.length > 0 && (
        <p className="text-xs text-[#FF3333]">
          {overLineIds.length} line{overLineIds.length === 1 ? "" : "s"} over remaining qty.
        </p>
      )}
      {error && <p className="text-xs text-[#FF3333]">{error}</p>}

      <div className="flex gap-2">
        <Button
          onClick={submit}
          disabled={busy || overPo || overLineIds.length > 0 || selectedRequested <= 0}
          className="bg-[#FF6600] text-black hover:bg-[#FF9900]"
        >
          {busy ? "Logging…" : "Log call-off"}
        </Button>
        <p className="text-[10px] text-muted-foreground self-center">
          Internal planning record. Create a Delivery Note next to record actual delivered qty.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const PO_TYPES = [
  { value: "STANDARD_FIXED", label: "Standard fixed" },
  { value: "DRAWDOWN_MATERIALS", label: "Drawdown — materials" },
  { value: "DRAWDOWN_LABOUR", label: "Drawdown — labour" },
] as const;

type QuoteLine = {
  id: string;
  ticketLineId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  alreadyPOd: boolean;
};

export function CreatePOForm({
  ticketId,
  defaultLimit,
  quoteNo,
  lines,
}: {
  ticketId: string;
  defaultLimit: number;
  quoteNo: string;
  lines: QuoteLine[];
}) {
  const router = useRouter();
  const availableLines = lines.filter((l) => !l.alreadyPOd);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(availableLines.map((l) => l.id))
  );
  const selectedTotal = lines
    .filter((l) => selectedIds.has(l.id))
    .reduce((sum, l) => sum + l.lineTotal, 0);
  const allSelected =
    availableLines.length > 0 && availableLines.every((l) => selectedIds.has(l.id));
  const someUnselected = selectedIds.size < availableLines.length;

  const [poNo, setPoNo] = useState("");
  const [poDate, setPoDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [poType, setPoType] = useState<(typeof PO_TYPES)[number]["value"]>("STANDARD_FIXED");
  const [poLimit, setPoLimit] = useState(String(defaultLimit));
  const [poLimitTouched, setPoLimitTouched] = useState(false);
  const [issuedBy, setIssuedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleLine(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (!poLimitTouched) {
        const newTotal = lines.filter((l) => next.has(l.id)).reduce((s, l) => s + l.lineTotal, 0);
        setPoLimit(newTotal.toFixed(2));
      }
      return next;
    });
  }

  function toggleAll() {
    const next = allSelected ? new Set<string>() : new Set(availableLines.map((l) => l.id));
    setSelectedIds(next);
    if (!poLimitTouched) {
      const newTotal = lines.filter((l) => next.has(l.id)).reduce((s, l) => s + l.lineTotal, 0);
      setPoLimit(newTotal.toFixed(2));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const limit = Number(poLimit);
      if (!Number.isFinite(limit) || limit <= 0) {
        setError("PO limit must be a positive number");
        setBusy(false);
        return;
      }
      if (selectedIds.size === 0) {
        setError("Select at least one line to put on the PO");
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/tickets/${ticketId}/convert-to-po`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNo: poNo.trim(),
          poDate,
          poType,
          poLimitValue: limit,
          issuedBy: issuedBy.trim() || undefined,
          notes: notes.trim() || undefined,
          selectedQuoteLineIds: Array.from(selectedIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Conversion failed");
        setBusy(false);
        return;
      }
      router.push(`/po-register?highlight=${data.poId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded border p-3 space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Lines on this PO</Label>
          <button
            type="button"
            onClick={toggleAll}
            disabled={availableLines.length === 0}
            className="text-[10px] underline text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {allSelected ? "Deselect all" : "Select all"}
          </button>
        </div>
        <div className="rounded border divide-y text-xs">
          {lines.length === 0 && (
            <div className="p-2 text-muted-foreground">Quote has no lines.</div>
          )}
          {lines.map((l) => {
            const checked = selectedIds.has(l.id);
            return (
              <label
                key={l.id}
                className={`flex items-start gap-2 p-2 ${l.alreadyPOd ? "opacity-50" : "cursor-pointer hover:bg-muted/40"}`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  disabled={l.alreadyPOd}
                  onChange={() => toggleLine(l.id)}
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate">{l.description}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {l.qty} × £{l.unitPrice.toFixed(2)} = £{l.lineTotal.toFixed(2)}
                    {l.alreadyPOd && " · already on a PO"}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {selectedIds.size} of {availableLines.length} available line
          {availableLines.length === 1 ? "" : "s"} selected · selected total £
          {selectedTotal.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {someUnselected && " · remaining lines stay open for a future PO"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="poNo">Customer PO number *</Label>
          <Input
            id="poNo"
            required
            value={poNo}
            onChange={(e) => setPoNo(e.target.value)}
            placeholder="e.g. FUSE-2026-001"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="poDate">PO date</Label>
          <Input
            id="poDate"
            type="date"
            value={poDate}
            onChange={(e) => setPoDate(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="poType">PO type</Label>
          <select
            id="poType"
            value={poType}
            onChange={(e) => setPoType(e.target.value as typeof poType)}
            className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
          >
            {PO_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="poLimit">PO limit value (£ ex VAT)</Label>
          <Input
            id="poLimit"
            type="number"
            step="0.01"
            min="0"
            value={poLimit}
            onChange={(e) => {
              setPoLimit(e.target.value);
              setPoLimitTouched(true);
            }}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="issuedBy">Issued by (contact)</Label>
        <Input
          id="issuedBy"
          value={issuedBy}
          onChange={(e) => setIssuedBy(e.target.value)}
          placeholder="Free text — name from PO email"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        PO will be created against quote <strong>{quoteNo}</strong>. Only the ticked lines copy
        across as PO lines; unticked lines stay open for a future PO. Ticket status advances to
        APPROVED. Call-offs draw against the limit.
      </p>
      {error && <p className="text-xs text-[#FF3333]">{error}</p>}
      <Button type="submit" disabled={busy} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
        {busy ? "Creating PO…" : "Create Customer PO"}
      </Button>
    </form>
  );
}

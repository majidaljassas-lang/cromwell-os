"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TicketMergeForm({
  ticketIds,
  defaultTitle,
  defaultFinalTotal,
  currentTotal,
}: {
  ticketIds: string[];
  defaultTitle: string;
  defaultFinalTotal: number | null;
  currentTotal: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(defaultTitle);
  const [finalTotal, setFinalTotal] = useState<string>(
    defaultFinalTotal !== null ? String(defaultFinalTotal) : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ft = finalTotal.trim() ? Number(finalTotal) : null;
      if (finalTotal.trim() && (!Number.isFinite(ft) || (ft as number) <= 0)) {
        setError("Final total must be a positive number");
        setBusy(false);
        return;
      }
      const res = await fetch("/api/tickets/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTicketIds: ticketIds,
          title: title.trim(),
          finalTotalExVat: ft,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Merge failed");
        setBusy(false);
        return;
      }
      router.push(`/tickets/${data.ticketId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded border p-3 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="title">Combined ticket title</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="finalTotal">
          Final agreed total (£ ex VAT) — leave blank to keep current line prices
        </Label>
        <Input
          id="finalTotal"
          type="number"
          step="0.01"
          min="0"
          placeholder="e.g. 32250.00"
          value={finalTotal}
          onChange={(e) => setFinalTotal(e.target.value)}
        />
        <p className="text-[10px] text-muted-foreground">
          Current line total: £
          {currentTotal.toLocaleString("en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          . Setting a final total scales every line proportionally so the sum matches exactly.
        </p>
      </div>
      {error && <p className="text-xs text-[#FF3333]">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
          {busy ? "Merging…" : "Merge into combined ticket"}
        </Button>
        <p className="text-[10px] text-muted-foreground self-center">
          Source tickets will be set to CLOSED.
        </p>
      </div>
    </form>
  );
}

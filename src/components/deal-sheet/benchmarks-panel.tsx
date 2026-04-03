"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type BenchmarkData = {
  id: string;
  ticketLineId: string;
  benchmarkSource: string;
  sourceRef: string | null;
  unitPrice: Decimal;
  qty: Decimal;
  totalPrice: Decimal;
  notes: string | null;
  ticketLine: { id: string; description: string };
};

type TicketLine = { id: string; description: string };

interface BenchmarksPanelProps {
  ticketId: string;
  benchmarks: BenchmarkData[];
  ticketLines: TicketLine[];
}

export function BenchmarksPanel({
  ticketId,
  benchmarks,
  ticketLines,
}: BenchmarksPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState("");

  // Group by ticket line
  const grouped: Record<string, BenchmarkData[]> = {};
  for (const bm of benchmarks) {
    const key = bm.ticketLine.description;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(bm);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const body = {
      ticketLineId: selectedLineId,
      benchmarkSource: fd.get("benchmarkSource") as string,
      unitPrice: fd.get("unitPrice") ? Number(fd.get("unitPrice")) : undefined,
      qty: fd.get("qty") ? Number(fd.get("qty")) : undefined,
      totalPrice: fd.get("totalPrice") ? Number(fd.get("totalPrice")) : undefined,
      notes: (fd.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch(`/api/tickets/${ticketId}/benchmarks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.reset();
        setOpen(false);
        setSelectedLineId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Benchmarks</CardTitle>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" variant="outline">
                <Plus className="size-3.5 mr-1" />
                Add Benchmark
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Benchmark</SheetTitle>
              <SheetDescription>
                Add a benchmark price for a ticket line.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label>Ticket Line</Label>
                <Select value={selectedLineId} onValueChange={(v) => setSelectedLineId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select line" />
                  </SelectTrigger>
                  <SelectContent>
                    {ticketLines.map((tl) => (
                      <SelectItem key={tl.id} value={tl.id}>
                        {tl.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="benchmarkSource">Source *</Label>
                <Input id="benchmarkSource" name="benchmarkSource" required placeholder="e.g. Travis Perkins" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="unitPrice">Unit Price</Label>
                  <Input id="unitPrice" name="unitPrice" type="number" step="0.01" placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qty">Qty</Label>
                  <Input id="qty" name="qty" type="number" step="0.01" placeholder="Optional" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totalPrice">Total Price</Label>
                <Input id="totalPrice" name="totalPrice" type="number" step="0.01" placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" placeholder="Optional notes" rows={2} />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting || !selectedLineId}>
                  {submitting ? "Adding..." : "Add Benchmark"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-[#888888] text-center py-4">
            No benchmarks yet.
          </p>
        ) : (
          Object.entries(grouped).map(([lineDesc, bms]) => (
            <div key={lineDesc}>
              <p className="text-xs font-medium text-[#888888] mb-1.5 uppercase tracking-wide">
                {lineDesc}
              </p>
              <div className="space-y-1.5">
                {bms.map((bm) => (
                  <div
                    key={bm.id}
                    className="flex items-center justify-between text-sm border border-[#333333] px-3 py-1.5"
                  >
                    <span className="font-medium">{bm.benchmarkSource}</span>
                    <div className="flex items-center gap-3 text-[#888888] text-xs">
                      <span className="tabular-nums font-medium text-[#E0E0E0]">
                        {dec(bm.unitPrice)}/unit
                      </span>
                      {bm.qty && <span>Qty: {dec(bm.qty)}</span>}
                      {bm.totalPrice && (
                        <span className="tabular-nums">Total: {dec(bm.totalPrice)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Separator className="mt-3" />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

type Decimal = { toString(): string } | string | number | null;

function n(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

function fmt(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type MaterialsEntry = {
  id: string;
  drawdownDate: string | Date;
  description: string;
  qty: Decimal;
  unitSell: Decimal;
  sellValue: Decimal;
  costValueActual: Decimal;
  overheadPct: Decimal;
  overheadValue: Decimal;
  grossProfitValue: Decimal;
  status: string;
};

type TicketOption = { id: string; title: string };
type TicketLineOption = { id: string; description: string };

export function MaterialsDrawdownTable({
  poId,
  entries,
  tickets,
  ticketLines = [],
}: {
  poId: string;
  entries: MaterialsEntry[];
  tickets: TicketOption[];
  ticketLines?: TicketLineOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [ticketLineId, setTicketLineId] = useState("");
  const [qty, setQty] = useState(1);
  const [unitSell, setUnitSell] = useState(0);
  const [costValueActual, setCostValueActual] = useState(0);

  const previewSell = qty * unitSell;
  const previewOverhead = previewSell * 0.1;
  const previewProfit = previewSell - costValueActual - previewOverhead;

  const totalSell = entries.reduce((s, e) => s + n(e.sellValue), 0);
  const totalCost = entries.reduce((s, e) => s + n(e.costValueActual), 0);
  const totalOverhead = entries.reduce((s, e) => s + n(e.overheadValue), 0);
  const totalProfit = entries.reduce((s, e) => s + n(e.grossProfitValue), 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const drawdownDate = formData.get("drawdownDate") as string;
    const description = formData.get("description") as string;

    if (!ticketId || !drawdownDate || !description) {
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/customer-pos/${poId}/materials-drawdowns`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticketId,
            ticketLineId: ticketLineId || undefined,
            drawdownDate,
            description,
            qty,
            unitSell,
            sellValue: previewSell,
            costValueActual,
          }),
        }
      );

      if (res.ok) {
        form.reset();
        setOpen(false);
        setTicketId("");
        setTicketLineId("");
        setQty(1);
        setUnitSell(0);
        setCostValueActual(0);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Materials Drawdown Entries</h3>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" variant="outline">
                <Plus className="size-4 mr-1" />
                Log Draw
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Log Materials Drawdown</SheetTitle>
              <SheetDescription>
                Record a materials draw against this PO.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="drawdownDate">Draw Date *</Label>
                <Input
                  id="drawdownDate"
                  name="drawdownDate"
                  type="date"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description *</Label>
                <Input
                  id="description"
                  name="description"
                  required
                  placeholder="e.g. 15mm copper pipe 3m"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Qty</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Unit Sell</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={unitSell}
                    onChange={(e) => setUnitSell(Number(e.target.value) || 0)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Sell Value (auto)</Label>
                <Input type="text" readOnly value={fmt(previewSell)} />
              </div>

              <div className="space-y-1.5">
                <Label>Actual Cost</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={costValueActual}
                  onChange={(e) =>
                    setCostValueActual(Number(e.target.value) || 0)
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Ticket *</Label>
                <Select
                  value={ticketId}
                  onValueChange={(v) => setTicketId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select ticket" />
                  </SelectTrigger>
                  <SelectContent>
                    {tickets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {ticketLines.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Ticket Line (optional)</Label>
                  <Select
                    value={ticketLineId}
                    onValueChange={(v) => setTicketLineId(v ?? "")}
                  >
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
              )}

              {/* Preview */}
              <div className=" border bg-[#222222] p-3 space-y-1 text-sm">
                <p className="font-medium text-xs uppercase tracking-wide text-[#888888] mb-2">
                  Preview
                </p>
                <div className="flex justify-between">
                  <span>Sell Value</span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewSell)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cost</span>
                  <span className="font-medium tabular-nums">
                    {fmt(costValueActual)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Overhead (10%)</span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewOverhead)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="font-medium">Profit</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      previewProfit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
                    }`}
                  >
                    {fmt(previewProfit)}
                  </span>
                </div>
              </div>

              <SheetFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Saving..." : "Log Draw"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Draw Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Sell</TableHead>
              <TableHead className="text-right">Sell Value</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Overhead</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-6 text-[#888888]"
                >
                  No materials entries logged yet.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular-nums">
                      {new Date(entry.drawdownDate).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {entry.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.unitSell)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.sellValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.costValueActual)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.overheadValue)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        n(entry.grossProfitValue) >= 0
                          ? "text-[#00CC66]"
                          : "text-[#FF3333]"
                      }`}
                    >
                      {fmt(entry.grossProfitValue)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Summary row */}
                <TableRow className="bg-[#222222] font-medium">
                  <TableCell colSpan={4} className="text-right">
                    Totals
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalSell)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalOverhead)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${
                      totalProfit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
                    }`}
                  >
                    {fmt(totalProfit)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

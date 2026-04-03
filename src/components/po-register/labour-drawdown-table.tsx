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

type LabourEntry = {
  id: string;
  workDate: string | Date;
  plumberContact?: { id: string; fullName: string } | null;
  dayType: string;
  plumberCount: number;
  daysWorked: Decimal;
  billableDayRate: Decimal;
  billableValue: Decimal;
  internalDayCost: Decimal;
  internalCostValue: Decimal;
  overheadPct: Decimal;
  overheadValue: Decimal;
  grossProfitValue: Decimal;
  status: string;
};

type ContactOption = { id: string; fullName: string };
type TicketOption = { id: string; title: string };
type SiteOption = { id: string; siteName: string };

export function LabourDrawdownTable({
  poId,
  entries,
  contacts,
  tickets,
  sites,
  weekdaySellRate = 450,
  weekendSellRate = 675,
  weekdayCostRate = 250,
  weekendCostRate = 375,
  overheadPct = 10,
}: {
  poId: string;
  entries: LabourEntry[];
  contacts: ContactOption[];
  tickets: TicketOption[];
  sites: SiteOption[];
  weekdaySellRate?: number;
  weekendSellRate?: number;
  weekdayCostRate?: number;
  weekendCostRate?: number;
  overheadPct?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [dayType, setDayType] = useState("WEEKDAY");
  const [plumberCount, setPlumberCount] = useState(1);
  const [daysWorked, setDaysWorked] = useState(1);
  const [ticketId, setTicketId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [plumberContactId, setPlumberContactId] = useState("");

  const sellRate = dayType === "WEEKEND" ? weekendSellRate : weekdaySellRate;
  const costRate = dayType === "WEEKEND" ? weekendCostRate : weekdayCostRate;
  const previewBillable = sellRate * daysWorked * plumberCount;
  const previewCost = costRate * daysWorked * plumberCount;
  const previewOverhead = previewBillable * (overheadPct / 100);
  const previewProfit = previewBillable - previewCost - previewOverhead;

  const totalBillable = entries.reduce((s, e) => s + n(e.billableValue), 0);
  const totalCost = entries.reduce((s, e) => s + n(e.internalCostValue), 0);
  const totalOverhead = entries.reduce((s, e) => s + n(e.overheadValue), 0);
  const totalProfit = entries.reduce((s, e) => s + n(e.grossProfitValue), 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const workDate = formData.get("workDate") as string;

    if (!ticketId || !siteId || !workDate) {
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/customer-pos/${poId}/labour-drawdowns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          siteId,
          workDate,
          plumberContactId: plumberContactId || undefined,
          dayType,
          plumberCount,
          daysWorked,
        }),
      });

      if (res.ok) {
        form.reset();
        setOpen(false);
        setDayType("WEEKDAY");
        setPlumberCount(1);
        setDaysWorked(1);
        setTicketId("");
        setSiteId("");
        setPlumberContactId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Labour Drawdown Entries</h3>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" variant="outline">
                <Plus className="size-4 mr-1" />
                Log Labour
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Log Labour Drawdown</SheetTitle>
              <SheetDescription>
                Record a day of labour against this PO.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="workDate">Work Date *</Label>
                <Input id="workDate" name="workDate" type="date" required />
              </div>

              <div className="space-y-1.5">
                <Label>Plumber</Label>
                <Select
                  value={plumberContactId}
                  onValueChange={(v) => setPlumberContactId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select plumber (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Day Type *</Label>
                <Select
                  value={dayType}
                  onValueChange={(v) => setDayType(v ?? "WEEKDAY")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKDAY">Weekday</SelectItem>
                    <SelectItem value="WEEKEND">Weekend</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plumber Count</Label>
                  <Input
                    type="number"
                    min={1}
                    value={plumberCount}
                    onChange={(e) =>
                      setPlumberCount(Number(e.target.value) || 1)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Days Worked</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={daysWorked}
                    onChange={(e) =>
                      setDaysWorked(Number(e.target.value) || 1)
                    }
                  />
                </div>
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

              <div className="space-y-1.5">
                <Label>Site *</Label>
                <Select
                  value={siteId}
                  onValueChange={(v) => setSiteId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.siteName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Auto-calculated preview */}
              <div className=" border bg-[#222222] p-3 space-y-1 text-sm">
                <p className="font-medium text-xs uppercase tracking-wide text-[#888888] mb-2">
                  Preview
                </p>
                <div className="flex justify-between">
                  <span>
                    Billable: {fmt(sellRate)} x {daysWorked} x {plumberCount}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewBillable)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>
                    Cost: {fmt(costRate)} x {daysWorked} x {plumberCount}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewCost)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Overhead: {fmt(previewBillable)} x {overheadPct}%</span>
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
                  {submitting ? "Saving..." : "Log Labour"}
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
              <TableHead>Work Date</TableHead>
              <TableHead>Plumber</TableHead>
              <TableHead>Day Type</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Bill Rate</TableHead>
              <TableHead className="text-right">Bill Value</TableHead>
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
                  colSpan={11}
                  className="text-center py-6 text-[#888888]"
                >
                  No labour entries logged yet.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular-nums">
                      {new Date(entry.workDate).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell>
                      {entry.plumberContact?.fullName || "\u2014"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          entry.dayType === "WEEKEND"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {entry.dayType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.plumberCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.daysWorked)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.billableDayRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.billableValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.internalCostValue)}
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
                  <TableCell colSpan={6} className="text-right">
                    Totals
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalBillable)}
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

type SupplierOptionData = {
  id: string;
  ticketLineId: string;
  supplierId: string;
  sourceType: string;
  costUnit: Decimal;
  qtyAvailable: Decimal;
  leadTimeDays: number | null;
  isPreferred: boolean;
  notes: string | null;
  supplier: { id: string; name: string };
  ticketLine: { id: string; description: string };
};

type TicketLine = {
  id: string;
  description: string;
};

type SupplierData = { id: string; name: string };

interface SupplierOptionsPanelProps {
  ticketId: string;
  supplierOptions: SupplierOptionData[];
  ticketLines: TicketLine[];
  suppliers: SupplierData[];
}

export function SupplierOptionsPanel({
  ticketId,
  supplierOptions,
  ticketLines,
  suppliers,
}: SupplierOptionsPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [isPreferred, setIsPreferred] = useState(false);

  // Group by ticket line
  const grouped: Record<string, SupplierOptionData[]> = {};
  for (const opt of supplierOptions) {
    const key = opt.ticketLine.description;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(opt);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const body = {
      ticketLineId: selectedLineId,
      supplierId: selectedSupplierId,
      sourceType: (fd.get("sourceType") as string) || "MANUAL",
      costUnit: Number(fd.get("costUnit")),
      qtyAvailable: fd.get("qtyAvailable") ? Number(fd.get("qtyAvailable")) : undefined,
      leadTimeDays: fd.get("leadTimeDays") ? Number(fd.get("leadTimeDays")) : undefined,
      isPreferred,
      notes: (fd.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch(`/api/tickets/${ticketId}/supplier-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.reset();
        setOpen(false);
        setSelectedLineId("");
        setSelectedSupplierId("");
        setIsPreferred(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Supplier Options</CardTitle>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" variant="outline">
                <Plus className="size-3.5 mr-1" />
                Add Option
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Supplier Option</SheetTitle>
              <SheetDescription>
                Add a supplier pricing option for a ticket line.
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
                <Label>Supplier</Label>
                <Select value={selectedSupplierId} onValueChange={(v) => setSelectedSupplierId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sourceType">Source Type</Label>
                <Input id="sourceType" name="sourceType" defaultValue="MANUAL" placeholder="MANUAL" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="costUnit">Cost / Unit *</Label>
                <Input id="costUnit" name="costUnit" type="number" step="0.01" required placeholder="0.00" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qtyAvailable">Qty Available</Label>
                  <Input id="qtyAvailable" name="qtyAvailable" type="number" step="0.01" placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="leadTimeDays">Lead Time (days)</Label>
                  <Input id="leadTimeDays" name="leadTimeDays" type="number" placeholder="Optional" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPreferred"
                  checked={isPreferred}
                  onChange={(e) => setIsPreferred(e.target.checked)}
                  className="border border-[#333333]"
                />
                <Label htmlFor="isPreferred">Preferred Supplier</Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" name="notes" placeholder="Optional notes" rows={2} />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting || !selectedLineId || !selectedSupplierId}>
                  {submitting ? "Adding..." : "Add Option"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.keys(grouped).length === 0 ? (
          <p className="text-sm text-[#888888] text-center py-4">
            No supplier options yet.
          </p>
        ) : (
          Object.entries(grouped).map(([lineDesc, opts]) => (
            <div key={lineDesc}>
              <p className="text-xs font-medium text-[#888888] mb-1.5 uppercase tracking-wide">
                {lineDesc}
              </p>
              <div className="space-y-1.5">
                {opts.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between text-sm border border-[#333333] px-3 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{opt.supplier.name}</span>
                      {opt.isPreferred && (
                        <Star className="size-3.5 text-[#FF9900] fill-[#FF9900]" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[#888888] text-xs">
                      <span className="tabular-nums font-medium text-[#E0E0E0]">
                        {dec(opt.costUnit)}/unit
                      </span>
                      {opt.qtyAvailable && <span>Qty: {dec(opt.qtyAvailable)}</span>}
                      {opt.leadTimeDays !== null && <span>{opt.leadTimeDays}d lead</span>}
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

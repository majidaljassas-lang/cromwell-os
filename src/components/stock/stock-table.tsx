"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Package, Pencil, Trash2, RotateCcw, ArrowRightLeft } from "lucide-react";
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

type StockItem = {
  id: string;
  description: string;
  productCode: string | null;
  category: string | null;
  qtyOnHand: number;
  qtyOriginal: number;
  unit: string;
  costPerUnit: number;
  sourceType: string;
  supplierName: string | null;
  originTicketId: string | null;
  originTicketTitle: string | null;
  originBillNo: string | null;
  originBillId: string | null;
  outcome: string;
  outcomeDate: string | null;
  outcomeNotes: string | null;
  notes: string | null;
  totalUsed: number;
  totalValue: number;
  createdAt: string;
};

function dec(val: number): string {
  return val.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function sourceLabel(t: string) {
  switch (t) {
    case "RETURN": return "Return";
    case "MOQ_EXCESS": return "MOQ Excess";
    case "TRANSFER": return "Transfer";
    default: return "Other";
  }
}

function sourceBadgeClass(t: string) {
  switch (t) {
    case "RETURN": return "bg-[#FF3333]/15 text-[#FF3333]";
    case "MOQ_EXCESS": return "bg-[#FF9900]/15 text-[#FF9900]";
    case "TRANSFER": return "bg-[#3399FF]/15 text-[#3399FF]";
    default: return "bg-[#888888]/15 text-[#888888]";
  }
}

function outcomeBadge(o: string) {
  switch (o) {
    case "HOLDING": return <Badge className="text-[9px] bg-[#FF9900]/15 text-[#FF9900]">Holding</Badge>;
    case "ALLOCATED": return <Badge className="text-[9px] bg-[#00CC66]/15 text-[#00CC66]">Allocated</Badge>;
    case "RETURNED_TO_SUPPLIER": return <Badge className="text-[9px] bg-[#3399FF]/15 text-[#3399FF]">Returned</Badge>;
    case "WRITTEN_OFF": return <Badge className="text-[9px] bg-[#888888]/15 text-[#888888]">Written Off</Badge>;
    default: return <Badge variant="outline" className="text-[9px]">{o}</Badge>;
  }
}

export function StockTable({ items }: { items: StockItem[] }) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unit, setUnit] = useState("EA");
  const [sourceType, setSourceType] = useState("RETURN");
  const [editUnit, setEditUnit] = useState("EA");
  const [editSourceType, setEditSourceType] = useState("RETURN");
  const [search, setSearch] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("HOLDING");

  const filtered = items.filter((i) => {
    if (filterOutcome && i.outcome !== filterOutcome) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.description.toLowerCase().includes(q) ||
      (i.productCode || "").toLowerCase().includes(q) ||
      (i.supplierName || "").toLowerCase().includes(q) ||
      (i.originBillNo || "").toLowerCase().includes(q) ||
      (i.originTicketTitle || "").toLowerCase().includes(q)
    );
  });

  const holdingItems = items.filter((i) => i.outcome === "HOLDING");
  const totalValue = holdingItems.reduce((s, i) => s + i.totalValue, 0);
  const totalHolding = holdingItems.length;

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      description: fd.get("description") as string,
      productCode: fd.get("productCode") as string,
      category: fd.get("category") as string,
      qtyOnHand: fd.get("qtyOnHand") as string,
      unit,
      costPerUnit: fd.get("costPerUnit") as string,
      sourceType,
      supplierName: fd.get("supplierName") as string,
      originTicketTitle: fd.get("originTicketTitle") as string,
      originBillNo: fd.get("originBillNo") as string,
      notes: fd.get("notes") as string,
    };
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setAddOpen(false);
        setUnit("EA");
        setSourceType("RETURN");
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editItem) return;
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const body = {
      description: fd.get("description") as string,
      productCode: fd.get("productCode") as string,
      category: fd.get("category") as string,
      qtyOnHand: fd.get("qtyOnHand") as string,
      unit: editUnit,
      costPerUnit: fd.get("costPerUnit") as string,
      sourceType: editSourceType,
      supplierName: fd.get("supplierName") as string,
      originTicketTitle: fd.get("originTicketTitle") as string,
      originBillNo: fd.get("originBillNo") as string,
      notes: fd.get("notes") as string,
    };
    try {
      const res = await fetch(`/api/stock/${editItem.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditItem(null);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOutcome(id: string, outcome: string) {
    const notes = outcome === "RETURNED_TO_SUPPLIER"
      ? prompt("Return reference / notes (optional):")
      : outcome === "WRITTEN_OFF"
        ? prompt("Write-off reason:")
        : null;
    if (outcome === "WRITTEN_OFF" && notes === null) return; // cancelled

    await fetch(`/api/stock/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome, outcomeNotes: notes || undefined }),
    });
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this stock item?")) return;
    await fetch(`/api/stock/${id}`, { method: "DELETE" });
    router.refresh();
  }

  const unitOptions = ["EA", "M", "LENGTH", "PACK", "LOT", "SET"];
  const sourceOptions = [
    { value: "RETURN", label: "Return" },
    { value: "MOQ_EXCESS", label: "MOQ Excess" },
    { value: "TRANSFER", label: "Transfer" },
    { value: "OTHER", label: "Other" },
  ];

  function StockForm({
    onSubmit,
    defaults,
    unitVal,
    setUnitVal,
    srcVal,
    setSrcVal,
    buttonLabel,
  }: {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    defaults?: StockItem | null;
    unitVal: string;
    setUnitVal: (v: string) => void;
    srcVal: string;
    setSrcVal: (v: string) => void;
    buttonLabel: string;
  }) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
        <div className="space-y-1.5">
          <Label>Description *</Label>
          <Input name="description" required defaultValue={defaults?.description} placeholder="e.g. 28mm x 3M Copper Tube EN1057" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Source Type *</Label>
            <Select value={srcVal} onValueChange={(v) => setSrcVal(v ?? "RETURN")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {sourceOptions.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Supplier</Label>
            <Input name="supplierName" defaultValue={defaults?.supplierName || ""} placeholder="e.g. Wolseley, PTS" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Original Bill No.</Label>
            <Input name="originBillNo" defaultValue={defaults?.originBillNo || ""} placeholder="e.g. INV-00123" />
          </div>
          <div className="space-y-1.5">
            <Label>Original Job / Ticket</Label>
            <Input name="originTicketTitle" defaultValue={defaults?.originTicketTitle || ""} placeholder="e.g. Mirel Additions" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Product Code</Label>
            <Input name="productCode" defaultValue={defaults?.productCode || ""} placeholder="e.g. CT28-3M" />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Input name="category" defaultValue={defaults?.category || ""} placeholder="e.g. Copper, Fittings" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Qty *</Label>
            <Input name="qtyOnHand" type="number" step="0.01" required defaultValue={defaults?.qtyOnHand} placeholder="10" />
          </div>
          <div className="space-y-1.5">
            <Label>Unit</Label>
            <Select value={unitVal} onValueChange={(v) => setUnitVal(v ?? "EA")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {unitOptions.map((u) => (
                  <SelectItem key={u} value={u}>{u}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Cost/Unit (£) *</Label>
            <Input name="costPerUnit" type="number" step="0.01" required defaultValue={defaults?.costPerUnit} placeholder="25.92" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Notes</Label>
          <Input name="notes" defaultValue={defaults?.notes || ""} placeholder="Any additional info" />
        </div>
        <SheetFooter>
          <Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
            {submitting ? "Saving..." : buttonLabel}
          </Button>
        </SheetFooter>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-wide">Stock / Returns</h1>
          <p className="text-xs text-[#888888]">
            {totalHolding} items holding &middot; Total value: £{dec(totalValue)}
          </p>
        </div>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger
            render={
              <Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                <Plus className="size-4 mr-1" />
                Add Item
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Stock Item</SheetTitle>
              <SheetDescription>Add a return or MOQ excess item to temporary stock.</SheetDescription>
            </SheetHeader>
            <StockForm
              onSubmit={handleAdd}
              unitVal={unit}
              setUnitVal={setUnit}
              srcVal={sourceType}
              setSrcVal={setSourceType}
              buttonLabel="Add Item"
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search stock..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex gap-1">
          {[
            { value: "HOLDING", label: "Holding", color: "bg-[#FF9900]" },
            { value: "ALLOCATED", label: "Allocated", color: "bg-[#00CC66]" },
            { value: "RETURNED_TO_SUPPLIER", label: "Returned", color: "bg-[#3399FF]" },
            { value: "", label: "All", color: "bg-[#888888]" },
          ].map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filterOutcome === f.value ? "default" : "outline"}
              className={`h-7 text-[10px] ${filterOutcome === f.value ? `${f.color} text-black` : ""}`}
              onClick={() => setFilterOutcome(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Supplier / Bill</TableHead>
              <TableHead>Origin Job</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Cost/Unit</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-10 text-[#888888]">
                  <Package className="size-8 mx-auto mb-2 opacity-30" />
                  {filterOutcome === "HOLDING"
                    ? "No items in holding. Returns and MOQ excess will appear here."
                    : "No items match your filter."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((item) => (
                <TableRow key={item.id} className={item.outcome !== "HOLDING" ? "opacity-60" : ""}>
                  <TableCell>
                    <div className="text-sm font-medium">{item.description}</div>
                    {item.productCode && <div className="text-[10px] text-[#888888]">{item.productCode}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-[9px] ${sourceBadgeClass(item.sourceType)}`}>
                      {sourceLabel(item.sourceType)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs">{item.supplierName || "—"}</div>
                    {item.originBillNo && (
                      <div className="text-[10px] text-[#FF9900]">{item.originBillNo}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-[#888888] max-w-[120px] truncate">
                    {item.originTicketTitle || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {item.qtyOnHand <= 0 ? (
                      <Badge variant="destructive" className="text-[10px]">USED</Badge>
                    ) : (
                      <>{dec(item.qtyOnHand)}{item.qtyOriginal > item.qtyOnHand && (
                        <span className="text-[10px] text-[#888888]"> / {dec(item.qtyOriginal)}</span>
                      )}</>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-[#888888]">{item.unit}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{dec(item.costPerUnit)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">{dec(item.totalValue)}</TableCell>
                  <TableCell>{outcomeBadge(item.outcome)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {item.outcome === "HOLDING" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 w-6 p-0 text-[#3399FF] hover:text-[#2277DD]"
                            title="Return to supplier"
                            onClick={() => handleOutcome(item.id, "RETURNED_TO_SUPPLIER")}
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0"
                        onClick={() => { setEditItem(item); setEditUnit(item.unit); setEditSourceType(item.sourceType); }}
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 text-red-500 hover:text-red-400"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Sheet */}
      <Sheet open={!!editItem} onOpenChange={(open) => { if (!open) setEditItem(null); }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Edit Stock Item</SheetTitle>
            <SheetDescription>Update details for this return / excess item.</SheetDescription>
          </SheetHeader>
          {editItem && (
            <StockForm
              onSubmit={handleEdit}
              defaults={editItem}
              unitVal={editUnit}
              setUnitVal={setEditUnit}
              srcVal={editSourceType}
              setSrcVal={setEditSourceType}
              buttonLabel="Save Changes"
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

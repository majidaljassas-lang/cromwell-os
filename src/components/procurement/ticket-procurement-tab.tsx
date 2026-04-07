"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, FileText, ExternalLink } from "lucide-react";
import { OrderReconciliation } from "./order-reconciliation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "MATCHED":
    case "CONFIRMED":
    case "DELIVERED":
      return "default";
    case "PARTIAL":
    case "SUGGESTED":
    case "ISSUED":
      return "secondary";
    case "EXCEPTION":
    case "UNALLOCATED":
      return "destructive";
    default:
      return "outline";
  }
}

type ProcurementOrderLine = {
  id: string;
  description: string;
  qty: Decimal;
  unitCost: Decimal;
  lineTotal: Decimal;
  ticketLine: { id: string; description: string };
};

type ProcurementOrder = {
  id: string;
  poNo: string;
  status: string;
  totalCostExpected: Decimal;
  supplier: { id: string; name: string };
  lines: ProcurementOrderLine[];
};

type CostAllocationItem = {
  id: string;
  qtyAllocated: Decimal;
  unitCost: Decimal;
  totalCost: Decimal;
  allocationStatus: string;
  confidenceScore: Decimal;
  notes: string | null;
  ticketLine: { id: string; description: string };
  supplierBillLine: {
    id: string;
    description: string;
    supplierBill: { id: string; billNo: string };
  } | null;
  supplier: { id: string; name: string };
};

type AbsorbedCostItem = {
  id: string;
  description: string;
  amount: Decimal;
  allocationBasis: string | null;
  supplierBillLine: { id: string; description: string };
};

type SupplierOption = { id: string; name: string };
type TicketLineOption = { id: string; description: string; qty: Decimal; unit: string; expectedCostUnit: Decimal; status: string; sectionLabel: string | null; supplierName: string | null };

type Props = {
  ticketId: string;
  ticketTitle: string;
  ticketStatus: string;
  procurementOrders: ProcurementOrder[];
  supplierBills: any[];
  costAllocations: CostAllocationItem[];
  absorbedCosts: AbsorbedCostItem[];
  suppliers: SupplierOption[];
  ticketLines: TicketLineOption[];
};

export function TicketProcurementTab({
  ticketId,
  ticketTitle,
  ticketStatus,
  procurementOrders,
  costAllocations,
  absorbedCosts,
  suppliers,
  ticketLines,
}: Props) {
  const router = useRouter();
  const [orderedLines, setOrderedLines] = useState<Set<string>>(new Set());
  const [markingOrdered, setMarkingOrdered] = useState(false);
  const [selectedForPurchase, setSelectedForPurchase] = useState<Set<string>>(new Set());
  const [bulkSupplierId, setBulkSupplierId] = useState("");
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [ackSheetOpen, setAckSheetOpen] = useState(false);
  const [ackSubmitting, setAckSubmitting] = useState(false);

  async function handleLogAcknowledgement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAckSubmitting(true);
    const fd = new FormData(e.currentTarget);
    fd.append("supplierName", fd.get("ackSupplier") as string);
    fd.append("orderRef", fd.get("ackRef") as string);
    fd.append("totalNet", fd.get("ackNet") as string);
    fd.append("totalVat", fd.get("ackVat") as string);
    fd.append("notes", fd.get("ackNotes") as string);
    const fileInput = (e.currentTarget.querySelector('input[type="file"]') as HTMLInputElement);
    if (fileInput?.files?.[0]) {
      fd.append("file", fileInput.files[0]);
    }
    try {
      const res = await fetch(`/api/tickets/${ticketId}/log-purchase`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) {
        setAckSheetOpen(false);
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    } finally {
      setAckSubmitting(false);
    }
  }

  // Lines needing purchase (not yet in a PO)
  const poLineIds = new Set(
    procurementOrders.flatMap((po) => po.lines.map((l) => l.ticketLine?.id).filter(Boolean))
  );
  const needsPurchase = ticketLines.filter(
    (l) => !poLineIds.has(l.id) && l.status !== "ORDERED" && l.status !== "INVOICED" && l.status !== "CLOSED"
  );
  const showChecklist = needsPurchase.length > 0 && ["APPROVED", "QUOTED", "ORDERED"].includes(ticketStatus);

  async function handleMarkOrdered(lineId: string) {
    setOrderedLines((prev) => new Set([...prev, lineId]));
    await fetch(`/api/ticket-lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ORDERED" }),
    });
    router.refresh();
  }

  async function handleMarkAllOrdered() {
    setMarkingOrdered(true);
    for (const line of needsPurchase) {
      await fetch(`/api/ticket-lines/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ORDERED" }),
      });
    }
    setMarkingOrdered(false);
    router.refresh();
  }

  async function handleUndoOrdered(lineId: string) {
    setOrderedLines((prev) => { const next = new Set(prev); next.delete(lineId); return next; });
    await fetch(`/api/ticket-lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "READY_FOR_QUOTE" }),
    });
    router.refresh();
  }

  function togglePurchaseSelect(id: string) {
    setSelectedForPurchase((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAllForPurchase() {
    setSelectedForPurchase(new Set(needsPurchase.map((l) => l.id)));
  }

  function clearPurchaseSelection() {
    setSelectedForPurchase(new Set());
    setBulkSupplierId("");
  }

  async function handleBulkOrderWithSupplier() {
    if (selectedForPurchase.size === 0) return;
    setBulkProcessing(true);
    for (const lineId of selectedForPurchase) {
      const body: Record<string, unknown> = { status: "ORDERED" };
      if (bulkSupplierId) {
        const sup = suppliers.find((s) => s.id === bulkSupplierId);
        body.supplierId = bulkSupplierId;
        body.supplierName = sup?.name || "";
      }
      await fetch(`/api/ticket-lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    setBulkProcessing(false);
    setSelectedForPurchase(new Set());
    setBulkSupplierId("");
    router.refresh();
  }

  function handlePrint() {
    const rows = needsPurchase.map((line, i) => {
      const sectionRow = line.sectionLabel
        ? `<tr><td colspan="5" style="background:#eee;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;padding:8px">${line.sectionLabel}</td></tr>`
        : "";
      return `${sectionRow}<tr>
        <td style="text-align:center;width:30px"><input type="checkbox" style="width:14px;height:14px" /></td>
        <td>${line.description}</td>
        <td style="text-align:right;white-space:nowrap">${Number(line.qty?.toString() || 1)}</td>
        <td>${line.unit}</td>
        <td style="text-align:right;white-space:nowrap">${dec(line.expectedCostUnit)}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; }
      .sub { font-size:11px; color:#555; margin-top:2px; }
      .ref { font-size:13px; font-weight:600; margin-top:12px; }
      .meta { font-size:11px; color:#555; margin-top:2px; margin-bottom:16px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      table { width:100%; border-collapse:collapse; margin-top:8px; }
      th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; }
      .r { text-align:right; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Purchase Checklist</div>
      <hr />
      <div class="ref">${ticketTitle}</div>
      <div class="meta">Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} &middot; ${needsPurchase.length} items</div>
      <table>
        <thead><tr><th style="width:30px"></th><th>Description</th><th class="r">Qty</th><th>Unit</th><th class="r">Est. Cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body></html>`;

    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    }
  }

  // Lines already marked as ordered (for undo)
  const recentlyOrdered = ticketLines.filter(
    (l) => l.status === "ORDERED" && !poLineIds.has(l.id)
  );
  const [poLines, setPoLines] = useState([
    { ticketLineId: "", description: "", qty: "1", unitCost: "0", lineTotal: "0" },
  ]);

  // Summary calculations
  const totalOrdered = procurementOrders.reduce(
    (sum, po) => sum + Number(po.totalCostExpected?.toString() ?? 0),
    0
  );
  const totalAllocated = costAllocations.reduce(
    (sum, ca) => sum + Number(ca.totalCost?.toString() ?? 0),
    0
  );
  const totalAbsorbed = absorbedCosts.reduce(
    (sum, ac) => sum + Number(ac.amount?.toString() ?? 0),
    0
  );
  const unallocatedCount = costAllocations.filter(
    (ca) => ca.allocationStatus !== "MATCHED"
  ).length;

  function updatePoLine(idx: number, field: string, value: string) {
    setPoLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "qty" || field === "unitCost") {
        const q = Number(next[idx].qty) || 0;
        const u = Number(next[idx].unitCost) || 0;
        next[idx].lineTotal = (q * u).toFixed(2);
      }
      return next;
    });
  }

  function addPoLine() {
    setPoLines((prev) => [
      ...prev,
      { ticketLineId: "", description: "", qty: "1", unitCost: "0", lineTotal: "0" },
    ]);
  }

  function removePoLine(idx: number) {
    setPoLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCreatePO(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      ticketId,
      supplierId,
      poNo: fd.get("poNo") as string,
      supplierRef: (fd.get("supplierRef") as string) || undefined,
      siteRef: (fd.get("siteRef") as string) || undefined,
      lines: poLines
        .filter((l) => l.description.trim())
        .map((l) => ({
          ticketLineId: l.ticketLineId || undefined,
          description: l.description,
          qty: Number(l.qty) || 1,
          unitCost: Number(l.unitCost) || 0,
          lineTotal: Number(l.lineTotal) || 0,
        })),
    };

    try {
      const res = await fetch("/api/procurement-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setPoSheetOpen(false);
        setSupplierId("");
        setPoLines([
          { ticketLineId: "", description: "", qty: "1", unitCost: "0", lineTotal: "0" },
        ]);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">

      {/* Purchase Checklist */}
      {showChecklist && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] uppercase tracking-widest text-[#FF9900] font-bold">
              Purchase Checklist — {needsPurchase.length} items to order
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrint}
            >
              Print Checklist
            </Button>
          </div>

          {/* Bulk Action Bar */}
          {selectedForPurchase.size > 0 && (
            <div className="flex items-center gap-3 border border-[#3399FF]/30 bg-[#3399FF]/5 px-3 py-2 print-hidden">
              <span className="text-xs text-[#3399FF] font-bold">{selectedForPurchase.size} selected</span>
              <Select value={bulkSupplierId} onValueChange={setBulkSupplierId}>
                <SelectTrigger className="w-48 h-7 text-xs">
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="bg-[#00CC66] text-black hover:bg-[#00AA55] h-7 text-xs"
                onClick={handleBulkOrderWithSupplier}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? "Processing..." : bulkSupplierId ? "Mark Ordered from Supplier" : "Mark Ordered"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={clearPurchaseSelection}>
                Clear
              </Button>
            </div>
          )}

          <div className="border border-[#FF9900]/30 bg-[#FF9900]/5 print-checklist">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={selectedForPurchase.size === needsPurchase.length && needsPurchase.length > 0}
                      onChange={() => selectedForPurchase.size === needsPurchase.length ? clearPurchaseSelection() : selectAllForPurchase()}
                      className="accent-[#3399FF]"
                    />
                  </TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Est. Cost</TableHead>
                  <TableHead className="w-24 print-hidden">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {needsPurchase.map((line) => {
                  const done = orderedLines.has(line.id);
                  return (
                    <React.Fragment key={line.id}>
                      {line.sectionLabel && (
                        <TableRow className="bg-[#252525] border-t-2 border-[#555555]">
                          <TableCell colSpan={6} className="py-2 px-3">
                            <span className="text-[11px] uppercase tracking-widest font-bold text-[#FF9900]">
                              {line.sectionLabel}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className={`${selectedForPurchase.has(line.id) ? "bg-[#3399FF]/5" : ""}`}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedForPurchase.has(line.id)}
                            onChange={() => togglePurchaseSelect(line.id)}
                            className="accent-[#3399FF]"
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">{line.description}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{dec(line.qty)}</TableCell>
                        <TableCell className="text-xs text-[#888888]">{line.unit}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{dec(line.expectedCostUnit)}</TableCell>
                        <TableCell className="print-hidden">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] bg-[#222222] border-[#333333]"
                            onClick={() => handleMarkOrdered(line.id)}
                          >
                            Ordered
                          </Button>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Ordered Items — grouped by supplier */}
      {recentlyOrdered.length > 0 && (() => {
        const grouped: Record<string, typeof recentlyOrdered> = {};
        for (const line of recentlyOrdered) {
          const key = line.supplierName || "No Supplier Assigned";
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(line);
        }
        return (
          <div className="space-y-3">
            <h3 className="text-[11px] uppercase tracking-widest text-[#00CC66] font-bold">
              Ordered — {recentlyOrdered.length} items
            </h3>
            {Object.entries(grouped).map(([supplier, lines]) => (
              <div key={supplier} className="border border-[#00CC66]/20 bg-[#00CC66]/5">
                <div className="px-3 py-2 border-b border-[#00CC66]/15 flex items-center gap-2">
                  <Badge className="text-[9px] bg-[#3399FF]/15 text-[#3399FF]">{supplier}</Badge>
                  <span className="text-[10px] text-[#888888]">{lines.length} items</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Est. Cost</TableHead>
                      <TableHead className="w-16 print-hidden"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="text-sm">{line.description}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{dec(line.qty)}</TableCell>
                        <TableCell className="text-xs text-[#888888]">{line.unit}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{dec(line.expectedCostUnit)}</TableCell>
                        <TableCell className="print-hidden">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[10px] text-[#FF9900] hover:text-[#FF6600] border-[#333333]"
                            onClick={() => handleUndoOrdered(line.id)}
                          >
                            Undo
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4 print-hidden">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[#888888]">Total Ordered Cost</p>
            <p className="text-xl font-semibold tabular-nums">{dec(totalOrdered)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[#888888]">Total Allocated Cost</p>
            <p className="text-xl font-semibold tabular-nums">{dec(totalAllocated)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[#888888]">Total Absorbed</p>
            <p className="text-xl font-semibold tabular-nums">{dec(totalAbsorbed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[#888888]">Unallocated</p>
            <p className="text-xl font-semibold tabular-nums">{unallocatedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Order Acknowledgements + Procurement Orders */}
      <div className="space-y-3 print-hidden">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">
            Orders ({procurementOrders.length})
          </h3>
          <div className="flex gap-2">
            <Sheet open={ackSheetOpen} onOpenChange={setAckSheetOpen}>
              <SheetTrigger
                render={
                  <Button size="sm" className="bg-[#3399FF] text-white hover:bg-[#2277DD]">
                    <Upload className="size-4 mr-1" />
                    Log Acknowledgement
                  </Button>
                }
              />
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Log Order Acknowledgement</SheetTitle>
                  <SheetDescription>
                    Upload a supplier order acknowledgement. This will be auto-matched in future.
                  </SheetDescription>
                </SheetHeader>
                <form onSubmit={handleLogAcknowledgement} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
                  <div className="space-y-1.5">
                    <Label>Supplier Name *</Label>
                    <Input name="ackSupplier" required placeholder="e.g. Verdis, APP Wholesale" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Order Reference *</Label>
                    <Input name="ackRef" required placeholder="e.g. 0001/07546086" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Net Amount (£)</Label>
                      <Input name="ackNet" type="number" step="0.01" placeholder="0.00" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>VAT (£)</Label>
                      <Input name="ackVat" type="number" step="0.01" placeholder="0.00" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Input name="ackNotes" placeholder="e.g. Delivery expected tomorrow" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Upload Document</Label>
                    <Input type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-xs" />
                  </div>
                  <SheetFooter>
                    <Button type="submit" disabled={ackSubmitting} className="bg-[#3399FF] text-white hover:bg-[#2277DD]">
                      {ackSubmitting ? "Logging..." : "Log Acknowledgement"}
                    </Button>
                  </SheetFooter>
                </form>
              </SheetContent>
            </Sheet>
          <Sheet open={poSheetOpen} onOpenChange={setPoSheetOpen}>
            <SheetTrigger
              render={
                <Button size="sm" variant="outline">
                  <Plus className="size-4 mr-1" />
                  Create PO
                </Button>
              }
            />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Create Procurement Order</SheetTitle>
                <SheetDescription>
                  Create a new purchase order for this ticket.
                </SheetDescription>
              </SheetHeader>
              <form
                onSubmit={handleCreatePO}
                className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
              >
                <div className="space-y-1.5">
                  <Label>Supplier *</Label>
                  <Select
                    value={supplierId}
                    onValueChange={(v) => setSupplierId(v ?? "")}
                  >
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
                  <Label htmlFor="poNo">PO Number *</Label>
                  <Input id="poNo" name="poNo" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="supplierRef">Supplier Ref</Label>
                    <Input id="supplierRef" name="supplierRef" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="po-siteRef">Site Ref</Label>
                    <Input id="po-siteRef" name="siteRef" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPoLine}
                    >
                      <Plus className="size-3 mr-1" />
                      Add Line
                    </Button>
                  </div>
                  {poLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="border border-[#333333] p-3 space-y-2 relative"
                    >
                      {poLines.length > 1 && (
                        <button
                          type="button"
                          className="absolute top-1 right-2 text-xs text-[#888888] hover:text-[#FF3333]"
                          onClick={() => removePoLine(idx)}
                        >
                          Remove
                        </button>
                      )}
                      <Select
                        value={line.ticketLineId}
                        onValueChange={(v) =>
                          updatePoLine(idx, "ticketLineId", v ?? "")
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Link to ticket line (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {ticketLines.map((tl) => (
                            <SelectItem key={tl.id} value={tl.id}>
                              {tl.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Description"
                        value={line.description}
                        onChange={(e) =>
                          updatePoLine(idx, "description", e.target.value)
                        }
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          placeholder="Qty"
                          type="number"
                          step="0.01"
                          value={line.qty}
                          onChange={(e) =>
                            updatePoLine(idx, "qty", e.target.value)
                          }
                        />
                        <Input
                          placeholder="Unit Cost"
                          type="number"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(e) =>
                            updatePoLine(idx, "unitCost", e.target.value)
                          }
                        />
                        <Input
                          placeholder="Line Total"
                          type="number"
                          step="0.01"
                          value={line.lineTotal}
                          readOnly
                          className="bg-[#222222]"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <SheetFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create PO"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
          </div>
        </div>

        <div className="border border-[#333333] bg-[#1A1A1A]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO No</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="text-right">Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {procurementOrders.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-6 text-[#888888]"
                  >
                    No orders logged yet. Upload supplier acknowledgements above.
                  </TableCell>
                </TableRow>
              ) : (
                procurementOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.poNo}</TableCell>
                    <TableCell>{po.supplier.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(po.status)}>
                        {po.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(po.totalCostExpected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {po.lines.length}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Order Reconciliation */}
      {procurementOrders.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-medium">Order Reconciliation</h3>
          <OrderReconciliation ticketId={ticketId} />
        </div>
      )}

      {/* Cost Allocations for this ticket */}
      <div className="space-y-3">
        <h3 className="text-base font-medium">
          Cost Allocations ({costAllocations.length})
        </h3>
        <div className="border border-[#333333] bg-[#1A1A1A]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket Line</TableHead>
                <TableHead>Bill Line</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costAllocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-6 text-[#888888]"
                  >
                    No cost allocations for this ticket.
                  </TableCell>
                </TableRow>
              ) : (
                costAllocations.map((ca) => (
                  <TableRow key={ca.id}>
                    <TableCell className="font-medium max-w-[150px] truncate">
                      {ca.ticketLine.description}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {ca.supplierBillLine?.description || ca.notes || "PO allocation"}
                    </TableCell>
                    <TableCell>{ca.supplier.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ca.qtyAllocated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ca.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ca.totalCost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ca.allocationStatus)}>
                        {ca.allocationStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Absorbed Costs for this ticket */}
      <div className="space-y-3">
        <h3 className="text-base font-medium">
          Absorbed Costs ({absorbedCosts.length})
        </h3>
        {absorbedCosts.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-[#888888]">
              No absorbed costs for this ticket.
            </CardContent>
          </Card>
        ) : (
          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Bill Line</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Basis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {absorbedCosts.map((ac) => (
                  <TableRow key={ac.id}>
                    <TableCell className="font-medium">
                      {ac.description}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {ac.supplierBillLine?.description || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ac.amount)}
                    </TableCell>
                    <TableCell className="text-[#888888]">
                      {ac.allocationBasis || "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

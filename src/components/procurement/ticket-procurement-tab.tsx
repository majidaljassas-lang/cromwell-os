"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, FileText, ExternalLink, Package, Pencil, Trash2 } from "lucide-react";
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
type StockItemOption = { id: string; description: string; productCode: string | null; qtyOnHand: Decimal; unit: string; costPerUnit: Decimal; supplierName: string | null; sourceType: string; originBillNo: string | null; originTicketTitle: string | null };

type Props = {
  ticketId: string;
  ticketTitle: string;
  ticketStatus: string;
  procurementOrders: ProcurementOrder[];
  supplierBills: any[];
  costAllocations: CostAllocationItem[];
  absorbedCosts: AbsorbedCostItem[];
  suppliers: SupplierOption[];
  stockItems?: StockItemOption[];
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
  stockItems = [],
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
  const [editPOId, setEditPOId] = useState<string | null>(null);
  const [editPOSubmitting, setEditPOSubmitting] = useState(false);
  const [deliveryNoteOpen, setDeliveryNoteOpen] = useState(false);
  const [deliveryItems, setDeliveryItems] = useState<Record<string, { status: "DELIVERED" | "BACK_ORDER" | "NOT_ORDERED" | "PARTIAL"; qtyDelivered: number; qtyTotal: number }>>({});
  const [absorbedOpen, setAbsorbedOpen] = useState(false);
  const [absorbedSubmitting, setAbsorbedSubmitting] = useState(false);
  const [stockPickerLine, setStockPickerLine] = useState<string | null>(null);
  const [stockPickerItemId, setStockPickerItemId] = useState("");
  const [stockPickerQty, setStockPickerQty] = useState("");
  const [stockPickerSubmitting, setStockPickerSubmitting] = useState(false);

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
    (l) => !poLineIds.has(l.id) && l.status !== "ORDERED" && l.status !== "FROM_STOCK" && l.status !== "INVOICED" && l.status !== "CLOSED"
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

  async function handleUseStock() {
    if (!stockPickerLine || !stockPickerItemId) return;
    setStockPickerSubmitting(true);
    try {
      const ticketLine = ticketLines.find((l) => l.id === stockPickerLine);
      const qty = stockPickerQty || (ticketLine ? Number(ticketLine.qty?.toString() || 1) : 1);
      const res = await fetch(`/api/stock/${stockPickerItemId}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketLineId: stockPickerLine, qtyUsed: Number(qty) }),
      });
      if (res.ok) {
        setStockPickerLine(null);
        setStockPickerItemId("");
        setStockPickerQty("");
        router.refresh();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to use stock");
      }
    } finally {
      setStockPickerSubmitting(false);
    }
  }

  async function handleAddAbsorbed(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAbsorbedSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/absorbed-cost-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          description: fd.get("description") as string,
          amount: Number(fd.get("amount")),
          allocationBasis: fd.get("basis") as string || "OTHER",
        }),
      });
      if (res.ok) {
        setAbsorbedOpen(false);
        (e.target as HTMLFormElement).reset();
        router.refresh();
      }
    } finally {
      setAbsorbedSubmitting(false);
    }
  }

  async function handleEditPO(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editPOId) return;
    setEditPOSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await fetch(`/api/procurement-orders/${editPOId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poNo: fd.get("poNo") as string,
          status: fd.get("status") as string,
          totalCostExpected: Number(fd.get("totalCostExpected")) || 0,
          supplierRef: fd.get("supplierRef") as string || undefined,
        }),
      });
      setEditPOId(null);
      router.refresh();
    } finally {
      setEditPOSubmitting(false);
    }
  }

  async function handleDeletePO(poId: string) {
    if (!confirm("Delete this procurement order and all its lines?")) return;
    await fetch(`/api/procurement-orders/${poId}`, { method: "DELETE" });
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

  function openDeliveryNote() {
    const items: Record<string, { status: "DELIVERED" | "BACK_ORDER" | "NOT_ORDERED" | "PARTIAL"; qtyDelivered: number; qtyTotal: number }> = {};
    for (const l of ticketLines) {
      const qty = Number(l.qty?.toString() || 0);
      if (l.status === "PARTIALLY_ORDERED") items[l.id] = { status: "BACK_ORDER", qtyDelivered: 0, qtyTotal: qty };
      else if (l.status === "ORDERED" || l.status === "FROM_STOCK" || l.status === "PARTIALLY_COSTED" || l.status === "FULLY_COSTED" || l.status === "INVOICED") items[l.id] = { status: "DELIVERED", qtyDelivered: qty, qtyTotal: qty };
      else items[l.id] = { status: "NOT_ORDERED", qtyDelivered: 0, qtyTotal: qty };
    }
    setDeliveryItems(items);
    setDeliveryNoteOpen(true);
  }

  function printDeliveryNote() {
    const rows = ticketLines.map((line) => {
      const item = deliveryItems[line.id] || { status: "DELIVERED", qtyDelivered: Number(line.qty?.toString() || 0), qtyTotal: Number(line.qty?.toString() || 0) };
      const backQty = item.qtyTotal - item.qtyDelivered;
      const sectionRow = line.sectionLabel
        ? `<tr><td colspan="6" style="background:#eee;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;padding:8px">${line.sectionLabel}</td></tr>`
        : "";

      if (item.status === "NOT_ORDERED") return "";

      const statusLabel = item.status === "DELIVERED" ? "✓ Delivered" :
        item.status === "PARTIAL" ? `✓ ${item.qtyDelivered} delivered / ${backQty} back order` :
        item.status === "BACK_ORDER" ? "⏳ Back Order" : "";
      const color = item.status === "DELIVERED" ? "#000" : item.status === "PARTIAL" ? "#FF6600" : "#FF6600";

      return `${sectionRow}<tr>
        <td style="width:24px;text-align:center">${item.status === "BACK_ORDER" ? "☐" : "☑"}</td>
        <td>${line.description}</td>
        <td style="text-align:right">${item.qtyDelivered > 0 ? item.qtyDelivered : "—"}</td>
        <td style="text-align:right;color:#FF6600">${backQty > 0 ? backQty : ""}</td>
        <td>${line.unit}</td>
        <td style="font-size:10px;font-weight:bold;color:${color}">${statusLabel}</td>
      </tr>`;
    }).join("");

    const deliveredCount = ticketLines.filter((l) => deliveryItems[l.id]?.status === "DELIVERED").length;
    const partialCount = ticketLines.filter((l) => deliveryItems[l.id]?.status === "PARTIAL").length;
    const backOrderCount = ticketLines.filter((l) => deliveryItems[l.id]?.status === "BACK_ORDER").length;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; } .sub { font-size:11px; color:#555; margin-top:2px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      .ref { font-size:13px; font-weight:600; margin-top:12px; }
      .meta { font-size:11px; color:#555; margin-top:2px; margin-bottom:16px; }
      table { width:100%; border-collapse:collapse; margin-top:8px; }
      th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; }
      .sig { margin-top:40px; display:flex; gap:60px; } .sig-box { border-top:1px solid #000; padding-top:4px; width:200px; font-size:10px; color:#555; }
      .summary { margin-top:12px; font-size:11px; display:flex; gap:30px; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Delivery Note</div>
      <hr />
      <div class="ref">${ticketTitle}</div>
      <div class="meta">Date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
      <table>
        <thead><tr><th style="width:24px"></th><th>Description</th><th style="text-align:right">Delivered</th><th style="text-align:right;color:#FF6600">Back Order</th><th>Unit</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><b>Delivered:</b> ${deliveredCount}</div>
        <div><b>Partial:</b> ${partialCount}</div>
        <div><b>Back Order:</b> ${backOrderCount}</div>
        <div><b>Total Lines:</b> ${ticketLines.length}</div>
      </div>
      <div class="sig">
        <div class="sig-box">Received By (Print Name)</div>
        <div class="sig-box">Signature</div>
        <div class="sig-box">Date</div>
      </div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
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
      {/* Delivery Note — always available */}
      <div className="flex justify-end mb-2">
        <Button size="sm" variant="outline" onClick={openDeliveryNote}>
          Delivery Note
        </Button>
      </div>

      {/* Interactive Delivery Note Sheet */}
      <Sheet open={deliveryNoteOpen} onOpenChange={setDeliveryNoteOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Delivery Note</SheetTitle>
            <SheetDescription>Mark each item as delivered or back order, then print.</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-1 px-4 flex-1 overflow-y-auto max-h-[70vh]">
            {ticketLines.map((line) => {
              const item = deliveryItems[line.id] || { status: "DELIVERED", qtyDelivered: Number(line.qty?.toString() || 0), qtyTotal: Number(line.qty?.toString() || 0) };
              const bgColor = item.status === "DELIVERED" ? "bg-[#00CC66]/10 border-[#00CC66]/30"
                : item.status === "PARTIAL" ? "bg-[#FF9900]/10 border-[#FF9900]/30"
                : item.status === "BACK_ORDER" ? "bg-[#FF3333]/10 border-[#FF3333]/30"
                : "bg-[#333333]/10 border-[#333333] opacity-50";
              return (
                <div key={line.id} className={`p-2 border ${bgColor}`}>
                  <div className="flex items-center gap-1 mb-1">
                    <span className="text-xs flex-1 truncate font-medium">{line.description}</span>
                    <span className="text-[10px] text-[#888888] tabular-nums whitespace-nowrap">{item.qtyTotal} {line.unit}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant={item.status === "DELIVERED" ? "default" : "outline"}
                      className={`h-5 text-[9px] px-2 ${item.status === "DELIVERED" ? "bg-[#00CC66] text-black" : ""}`}
                      onClick={() => setDeliveryItems((prev) => ({ ...prev, [line.id]: { ...item, status: "DELIVERED", qtyDelivered: item.qtyTotal } }))}
                    >✓ All</Button>
                    <Button size="sm" variant={item.status === "PARTIAL" ? "default" : "outline"}
                      className={`h-5 text-[9px] px-2 ${item.status === "PARTIAL" ? "bg-[#FF9900] text-black" : ""}`}
                      onClick={() => setDeliveryItems((prev) => ({ ...prev, [line.id]: { ...item, status: "PARTIAL", qtyDelivered: Math.min(item.qtyDelivered || 1, item.qtyTotal - 1) } }))}
                    >Part</Button>
                    <Button size="sm" variant={item.status === "BACK_ORDER" ? "default" : "outline"}
                      className={`h-5 text-[9px] px-2 ${item.status === "BACK_ORDER" ? "bg-[#FF3333] text-white" : ""}`}
                      onClick={() => setDeliveryItems((prev) => ({ ...prev, [line.id]: { ...item, status: "BACK_ORDER", qtyDelivered: 0 } }))}
                    >B/O</Button>
                    {item.status === "PARTIAL" && (
                      <Input
                        type="number"
                        min={1}
                        max={item.qtyTotal - 1}
                        value={item.qtyDelivered}
                        onChange={(e) => setDeliveryItems((prev) => ({ ...prev, [line.id]: { ...item, qtyDelivered: Number(e.target.value) || 0 } }))}
                        className="h-5 w-14 text-[10px] text-center px-1"
                      />
                    )}
                    {item.status === "PARTIAL" && (
                      <span className="text-[9px] text-[#FF9900]">{item.qtyDelivered}/{item.qtyTotal}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <SheetFooter>
            <div className="flex gap-2 px-4">
              <Button variant="outline" size="sm" onClick={() => {
                const items: typeof deliveryItems = {};
                ticketLines.forEach((l) => {
                  const qty = Number(l.qty?.toString() || 0);
                  items[l.id] = { status: "DELIVERED", qtyDelivered: qty, qtyTotal: qty };
                });
                setDeliveryItems(items);
              }}>All Delivered</Button>
              <Button onClick={printDeliveryNote} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                Print Delivery Note
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {showChecklist && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] uppercase tracking-widest text-[#FF9900] font-bold">
              Purchase Checklist — {needsPurchase.length} items to order
            </h3>
            <Button size="sm" variant="outline" onClick={handlePrint}>
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
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] bg-[#222222] border-[#333333]"
                              onClick={() => handleMarkOrdered(line.id)}
                            >
                              Ordered
                            </Button>
                            {stockItems.length > 0 && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] bg-[#222222] border-[#FF6600]/30 text-[#FF6600] hover:bg-[#FF6600]/10"
                                onClick={() => {
                                  setStockPickerLine(line.id);
                                  setStockPickerQty(String(Number(line.qty?.toString() || 1)));
                                }}
                              >
                                <Package className="size-3 mr-0.5" />
                                Stock
                              </Button>
                            )}
                          </div>
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

      {/* From Stock Items */}
      {(() => {
        const fromStock = ticketLines.filter(
          (l) => l.status === "FROM_STOCK" && !poLineIds.has(l.id)
        );
        if (fromStock.length === 0) return null;
        return (
          <div className="space-y-3">
            <h3 className="text-[11px] uppercase tracking-widest text-[#FF6600] font-bold">
              From Stock — {fromStock.length} items
            </h3>
            <div className="border border-[#FF6600]/20 bg-[#FF6600]/5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Est. Cost</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-16 print-hidden"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fromStock.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-sm">{line.description}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{dec(line.qty)}</TableCell>
                      <TableCell className="text-xs text-[#888888]">{line.unit}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{dec(line.expectedCostUnit)}</TableCell>
                      <TableCell>
                        <Badge className="text-[9px] bg-[#FF6600]/15 text-[#FF6600]">
                          {line.supplierName || "Stock"}
                        </Badge>
                      </TableCell>
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
          </div>
        );
      })()}

      {/* Stock Picker Sheet */}
      <Sheet open={!!stockPickerLine} onOpenChange={(open) => { if (!open) { setStockPickerLine(null); setStockPickerItemId(""); setStockPickerQty(""); } }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Use From Stock</SheetTitle>
            <SheetDescription>
              Select a stock item to fulfil this line from existing inventory.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
            {stockPickerLine && (() => {
              const line = ticketLines.find((l) => l.id === stockPickerLine);
              if (!line) return null;
              return (
                <div className="border border-[#333333] p-3 bg-[#222222]">
                  <p className="text-sm font-medium">{line.description}</p>
                  <p className="text-xs text-[#888888] mt-1">
                    Required: {dec(line.qty)} {line.unit} &middot; Est. cost: £{dec(line.expectedCostUnit)}/unit
                  </p>
                </div>
              );
            })()}
            <div className="space-y-1.5">
              <Label>Stock Item *</Label>
              <Select value={stockPickerItemId} onValueChange={(v) => setStockPickerItemId(v ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select stock item" />
                </SelectTrigger>
                <SelectContent>
                  {stockItems.map((si) => {
                    const typeTag = si.sourceType === "RETURN" ? "[R]" : si.sourceType === "MOQ_EXCESS" ? "[MOQ]" : "";
                    return (
                      <SelectItem key={si.id} value={si.id}>
                        <span>{typeTag} {si.description}</span>
                        <span className="text-[#888888] ml-2">({dec(si.qtyOnHand)} avail @ £{dec(si.costPerUnit)})</span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Qty to Use</Label>
              <Input
                type="number"
                step="0.01"
                value={stockPickerQty}
                onChange={(e) => setStockPickerQty(e.target.value)}
                placeholder="Defaults to line qty"
              />
            </div>
            {stockPickerItemId && (() => {
              const si = stockItems.find((s) => s.id === stockPickerItemId);
              if (!si) return null;
              const qty = Number(stockPickerQty) || 0;
              const cost = qty * Number(si.costPerUnit?.toString() || 0);
              const typeLabel = si.sourceType === "RETURN" ? "Return" : si.sourceType === "MOQ_EXCESS" ? "MOQ Excess" : si.sourceType;
              return (
                <div className="border border-[#FF6600]/20 bg-[#FF6600]/5 p-3 text-sm">
                  <p className="font-medium">{si.description}</p>
                  <p className="text-xs text-[#888888] mt-1">
                    Available: {dec(si.qtyOnHand)} {si.unit}
                    &middot; {typeLabel}
                    {si.supplierName && <> &middot; {si.supplierName}</>}
                    {si.originBillNo && <> &middot; Bill: {si.originBillNo}</>}
                  </p>
                  {qty > 0 && (
                    <p className="text-xs mt-1 font-medium text-[#FF6600]">
                      Cost: {qty} × £{dec(si.costPerUnit)} = £{dec(cost)}
                    </p>
                  )}
                </div>
              );
            })()}
            <SheetFooter>
              <Button
                disabled={!stockPickerItemId || !stockPickerQty || stockPickerSubmitting}
                onClick={handleUseStock}
                className="bg-[#FF6600] text-black hover:bg-[#CC5500]"
              >
                {stockPickerSubmitting ? "Using..." : "Use From Stock"}
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>

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
                <TableHead className="w-16"></TableHead>
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
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => setEditPOId(po.id)}>
                          <Pencil className="size-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 w-6 p-0 text-red-500 hover:text-red-400" onClick={() => handleDeletePO(po.id)}>
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Edit PO Sheet */}
          <Sheet open={!!editPOId} onOpenChange={(open) => { if (!open) setEditPOId(null); }}>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Edit Order</SheetTitle>
                <SheetDescription>Update procurement order details.</SheetDescription>
              </SheetHeader>
              {editPOId && (() => {
                const po = procurementOrders.find((p) => p.id === editPOId);
                if (!po) return null;
                return (
                  <form onSubmit={handleEditPO} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
                    <div className="space-y-1.5">
                      <Label>PO / Order No.</Label>
                      <Input name="poNo" defaultValue={po.poNo} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Status</Label>
                      <select name="status" defaultValue={po.status} className="w-full h-9 px-3 border border-[#333333] bg-[#111111] text-sm">
                        <option value="ACKNOWLEDGED">Acknowledged</option>
                        <option value="ISSUED">Issued</option>
                        <option value="DELIVERED">Delivered</option>
                        <option value="PARTIAL">Partial</option>
                        <option value="CANCELLED">Cancelled</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Total Cost (£)</Label>
                      <Input name="totalCostExpected" type="number" step="0.01" defaultValue={Number(po.totalCostExpected?.toString() || 0)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Supplier Ref</Label>
                      <Input name="supplierRef" defaultValue={po.supplier?.name || ""} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Re-upload Document</Label>
                      <Input type="file" accept=".pdf,.png,.jpg,.jpeg" className="text-xs" />
                    </div>
                    <SheetFooter>
                      <Button type="submit" disabled={editPOSubmitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                        {editPOSubmitting ? "Saving..." : "Save Changes"}
                      </Button>
                    </SheetFooter>
                  </form>
                );
              })()}
            </SheetContent>
          </Sheet>
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
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">
            Absorbed Costs ({absorbedCosts.length})
          </h3>
          <Sheet open={absorbedOpen} onOpenChange={setAbsorbedOpen}>
            <SheetTrigger render={
              <Button size="sm" variant="outline">
                <Plus className="size-4 mr-1" />
                Add Absorbed Cost
              </Button>
            } />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Add Absorbed Cost</SheetTitle>
                <SheetDescription>Log a cost absorbed by the business (delivery, courier, rush charge, etc.)</SheetDescription>
              </SheetHeader>
              <form onSubmit={handleAddAbsorbed} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
                <div className="space-y-1.5">
                  <Label>Description *</Label>
                  <Input name="description" required placeholder="e.g. Driver collection from APP Wholesale" />
                </div>
                <div className="space-y-1.5">
                  <Label>Amount (£) *</Label>
                  <Input name="amount" type="number" step="0.01" required placeholder="50.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Basis</Label>
                  <select name="basis" className="w-full h-9 px-3 border border-[#333333] bg-[#111111] text-sm">
                    <option value="COURIER_COLLECTION">Courier / Collection</option>
                    <option value="DELIVERY_CHARGE">Delivery Charge</option>
                    <option value="RUSH_FEE">Rush / Express Fee</option>
                    <option value="FUEL">Fuel</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <SheetFooter>
                  <Button type="submit" disabled={absorbedSubmitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                    {absorbedSubmitting ? "Adding..." : "Add Cost"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>
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
                  <TableHead className="w-8"></TableHead>
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
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 w-5 p-0 text-[#888888] hover:text-[#FF3333]"
                        onClick={async () => {
                          if (!confirm("Delete this absorbed cost?")) return;
                          await fetch(`/api/absorbed-cost-allocations?id=${ac.id}`, { method: "DELETE" });
                          router.refresh();
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
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

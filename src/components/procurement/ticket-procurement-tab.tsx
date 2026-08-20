"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
type StockUsageInfo = {
  id: string; qtyUsed: Decimal; costPerUnit: Decimal; totalCost: Decimal; stockItemId: string;
  stockItem?: { id: string; description: string; supplierName: string | null; originBillNo: string | null; sourceType: string; originTicketTitle: string | null };
};
type TicketLineOption = { id: string; description: string; qty: Decimal; unit: string; expectedCostUnit: Decimal; status: string; sectionLabel: string | null; supplierName: string | null; internalNotes?: string | null; substitutedFrom?: string | null; stockUsages?: StockUsageInfo[]; isBomParent?: boolean; parentLineId?: string | null; parentDescription?: string | null; parentQty?: Decimal | number | null; sourceItemIds?: string[] };
type StockItemOption = { id: string; description: string; productCode: string | null; qtyOnHand: Decimal; unit: string; costPerUnit: Decimal; supplierName: string | null; sourceType: string; originBillNo: string | null; originTicketTitle: string | null };

type CallOffOption = {
  id: string;
  callOffNo: number;
  coSeq?: number;
  status: string;
  callOffDate: string;
  customerPO: { id: string; poNo: string };
  lines: Array<{ ticketLineId: string; requestedQty: string | number; invoicedQty: string | number }>;
};

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
  customerPONo?: string | null;
  callOffs?: CallOffOption[];
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
  customerPONo = null,
  callOffs = [],
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
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().split("T")[0]);
  const [deliveryItems, setDeliveryItems] = useState<Record<string, { status: "DELIVERED" | "BACK_ORDER" | "NOT_ORDERED" | "PARTIAL" | "DIRECT"; qtyDelivered: number; qtyTotal: number }>>({});
  // "" = no scope (all ordered ticket lines); otherwise restrict to a single CallOff.
  const [dnCallOffId, setDnCallOffId] = useState<string>("");
  // Procurement checklist (stock vs order), scoped to a call-off — mirrors the DN sheet.
  const [procOpen, setProcOpen] = useState(false);
  const [procCallOffId, setProcCallOffId] = useState<string>("");
  const [procSubmitting, setProcSubmitting] = useState(false);
  const [procItems, setProcItems] = useState<
    Record<string, { action: "ORDER" | "SPLIT" | "STOCK" | "SKIP"; qtyTotal: number; qtyStock: number; stockItemId: string | null; stockAvail: number }>
  >({});
  // Prior DNs for this ticket — used to compute remaining outstanding qty so the
  // next sheet only shows what's still owed. Loaded on openDeliveryNote().
  const [priorDeliveryNotes, setPriorDeliveryNotes] = useState<Array<{
    id: string;
    deliveryNo: number;
    deliveryDate: string;
    callOffId: string | null;
    lines: Array<{ ticketLineId: string; qtyDelivered: string | number; qtyBackOrder: string | number; status: string; note?: string | null }>;
  }>>([]);
  const [absorbedOpen, setAbsorbedOpen] = useState(false);
  const [absorbedSubmitting, setAbsorbedSubmitting] = useState(false);
  const [stockPickerLine, setStockPickerLine] = useState<string | null>(null);
  const [stockPickerItemId, setStockPickerItemId] = useState("");
  const [stockPickerQty, setStockPickerQty] = useState("");
  const [stockPickerSubmitting, setStockPickerSubmitting] = useState(false);
  const [editLineItems, setEditLineItems] = useState<Array<{ id: string; description: string; qty: string; unitCost: string; lineTotal: string; supplierCode?: string }>>([]);

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

  // Canonical render order for the delivery note: each parent immediately followed by its children
  // (mirrors buildRenderOrder in src/lib/tickets/sync-downstream.ts). Independent of displayOrder gaps.
  const orderedTicketLines = useMemo<TicketLineOption[]>(() => {
    const filtered = ticketLines.filter((l) => {
      if (l.status === "INVOICED" && (!l.sourceItemIds || l.sourceItemIds.length === 0)) {
        return false;
      }
      return true;
    });
    const inScope = new Set(filtered.map((l) => l.id));
    const childrenByParent = new Map<string, TicketLineOption[]>();
    const orphans: TicketLineOption[] = [];
    for (const l of filtered) {
      if (l.parentLineId) {
        if (inScope.has(l.parentLineId)) {
          const arr = childrenByParent.get(l.parentLineId) ?? [];
          arr.push(l);
          childrenByParent.set(l.parentLineId, arr);
        } else {
          orphans.push(l);
        }
      }
    }
    const topLines = filtered.filter((l) => !l.parentLineId);
    const out: TicketLineOption[] = [];
    for (const p of topLines) {
      out.push(p);
      for (const k of childrenByParent.get(p.id) ?? []) out.push(k);
    }
    for (const o of orphans) out.push(o);
    return out;
  }, [ticketLines]);

  // Calculate stock usage per line
  function stockQtyUsed(line: TicketLineOption): number {
    if (!line.stockUsages?.length) return 0;
    return line.stockUsages.reduce((sum, su) => sum + Number(su.qtyUsed?.toString() || 0), 0);
  }
  function remainingQty(line: TicketLineOption): number {
    return Math.max(0, Number(line.qty?.toString() || 0) - stockQtyUsed(line));
  }

  // Lines needing purchase (not yet in a PO, and still have remaining qty to order)
  const poLineIds = new Set(
    procurementOrders.flatMap((po) => po.lines.map((l) => l.ticketLine?.id).filter(Boolean))
  );
  const needsPurchase = ticketLines.filter(
    (l) => !poLineIds.has(l.id) && l.status !== "ORDERED" && l.status !== "FROM_STOCK" && l.status !== "INVOICED" && l.status !== "CLOSED" && !l.isBomParent
  );
  const showChecklist = needsPurchase.length > 0 && !["CLOSED", "CANCELLED"].includes(ticketStatus);

  // Auto-detect stock matches for lines needing purchase
  function normalizeDesc(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  }
  const stockMatches = useMemo(() => {
    if (!stockItems.length || !needsPurchase.length) return [];
    const matches: Array<{ lineId: string; lineDesc: string; lineQty: number; lineUnit: string; stockId: string; stockDesc: string; stockQty: number; stockUnit: string; stockCost: number; sourceType: string }> = [];
    for (const line of needsPurchase) {
      const remaining = remainingQty(line);
      if (remaining <= 0) continue;
      const normLine = normalizeDesc(line.description);
      for (const si of stockItems) {
        const normStock = normalizeDesc(si.description);
        // Match if one contains the other, or if key tokens overlap significantly
        const lineTokens = normLine.split(" ").filter((t: string) => t.length > 1);
        const stockTokens = normStock.split(" ").filter((t: string) => t.length > 1);
        const overlap = lineTokens.filter((t: string) => stockTokens.includes(t)).length;
        const matchScore = lineTokens.length > 0 ? overlap / lineTokens.length : 0;
        if (matchScore >= 0.7 || normLine.includes(normStock) || normStock.includes(normLine)) {
          matches.push({
            lineId: line.id,
            lineDesc: line.description,
            lineQty: remaining,
            lineUnit: line.unit,
            stockId: si.id,
            stockDesc: si.description,
            stockQty: Number(si.qtyOnHand?.toString() || 0),
            stockUnit: si.unit,
            stockCost: Number(si.costPerUnit?.toString() || 0),
            sourceType: si.sourceType,
          });
        }
      }
    }
    return matches;
  }, [stockItems, needsPurchase]);

  async function handleMarkOrdered(lineId: string) {
    setOrderedLines((prev) => new Set([...prev, lineId]));
    const line = ticketLines.find(l => l.id === lineId);

    // Auto-create PO if supplier is known
    if (line?.supplierName) {
      const sup = suppliers.find(s => s.name.toLowerCase() === line.supplierName!.toLowerCase());
      const poNo = `PO-${Date.now()}-${line.supplierName.substring(0, 4).toUpperCase().replace(/\s/g, "")}`;
      await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          supplierId: sup?.id || undefined,
          poNo,
          lines: [{
            ticketLineId: lineId,
            description: line.description,
            qty: Number(line.qty?.toString() || 1),
            unitCost: Number(line.expectedCostUnit?.toString() || 0),
            lineTotal: Number(line.qty?.toString() || 1) * Number(line.expectedCostUnit?.toString() || 0),
          }],
        }),
      });
    }

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
      const qtyToUse = Number(stockPickerQty) || (ticketLine ? Number(ticketLine.qty?.toString() || 1) : 1);
      const res = await fetch(`/api/stock/${stockPickerItemId}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketLineId: stockPickerLine, qtyUsed: qtyToUse }),
      });
      if (res.ok) {
        // Check if stock now fully covers the line
        if (ticketLine) {
          const lineQty = Number(ticketLine.qty?.toString() || 0);
          const alreadyUsed = stockQtyUsed(ticketLine);
          const totalUsed = alreadyUsed + qtyToUse;
          if (totalUsed >= lineQty) {
            // Fully covered from stock — mark line
            await fetch(`/api/ticket-lines/${stockPickerLine}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "FROM_STOCK" }),
            });
          }
        }
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
    try {
      const selectedLines = needsPurchase.filter(l => selectedForPurchase.has(l.id));

      // If bulk supplier selected, assign it to all lines first
      if (bulkSupplierId) {
        const sup = suppliers.find((s) => s.id === bulkSupplierId);
        for (const line of selectedLines) {
          line.supplierName = sup?.name || null;
        }
      }

      // Group lines by supplier (known suppliers get POs, unknown just get marked)
      const bySupplier: Record<string, typeof selectedLines> = {};
      const noSupplier: typeof selectedLines = [];
      for (const line of selectedLines) {
        const supName = line.supplierName || (bulkSupplierId ? suppliers.find(s => s.id === bulkSupplierId)?.name : null);
        if (supName) {
          if (!bySupplier[supName]) bySupplier[supName] = [];
          bySupplier[supName].push(line);
        } else {
          noSupplier.push(line);
        }
      }

      // Create POs grouped by supplier
      for (const [supplierName, lines] of Object.entries(bySupplier)) {
        const sup = suppliers.find(s => s.name.toLowerCase() === supplierName.toLowerCase());
        const poNo = `PO-${Date.now()}-${supplierName.substring(0, 4).toUpperCase().replace(/\s/g, "")}`;
        await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticketId,
            supplierId: sup?.id || (bulkSupplierId || undefined),
            poNo,
            lines: lines.map(l => ({
              ticketLineId: l.id,
              description: l.description,
              qty: Number(l.qty?.toString() || 1),
              unitCost: Number(l.expectedCostUnit?.toString() || 0),
              lineTotal: Number(l.qty?.toString() || 1) * Number(l.expectedCostUnit?.toString() || 0),
            })),
          }),
        });
      }

      // Mark all selected lines as ORDERED
      for (const line of selectedLines) {
        const body: Record<string, unknown> = { status: "ORDERED" };
        if (bulkSupplierId) {
          const sup = suppliers.find((s) => s.id === bulkSupplierId);
          body.supplierId = bulkSupplierId;
          body.supplierName = sup?.name || "";
        }
        await fetch(`/api/ticket-lines/${line.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      setSelectedForPurchase(new Set());
      setBulkSupplierId("");
      router.refresh();
    } finally {
      setBulkProcessing(false);
    }
  }

  // BOM child qty is stored per-assembly; physical delivery qty = child.qty × parent.qty.
  function physicalQty(l: TicketLineOption): number {
    const own = Number(l.qty?.toString() || 0);
    if (!l.parentLineId) return own;
    const pq = Number(l.parentQty?.toString() || 1);
    return own * pq;
  }

  const loadPriorDeliveryNotes = useCallback(async (): Promise<typeof priorDeliveryNotes> => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/delivery-notes`);
      if (res.ok) {
        const data = await res.json();
        setPriorDeliveryNotes(data);
        return data;
      }
    } catch {
      // non-fatal
    }
    return [];
  }, [ticketId]);

  useEffect(() => {
    void loadPriorDeliveryNotes();
  }, [loadPriorDeliveryNotes]);

  // Auto-open the DN sheet pre-scoped to a call-off when navigated here with
  // ?openDn=<callOffId>. Runs once on mount and clears the param.
  const searchParams = useSearchParams();
  const openDnParam = searchParams?.get("openDn") ?? null;
  useEffect(() => {
    if (!openDnParam) return;
    if (!callOffs.some((c) => c.id === openDnParam)) return;
    void openDeliveryNote(openDnParam);
    // Strip the param so refresh doesn't keep re-opening
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("openDn");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDnParam]);

  function computeDeliveryItems(
    prior: typeof priorDeliveryNotes,
    callOffId: string
  ): Record<string, { status: "DELIVERED" | "BACK_ORDER" | "NOT_ORDERED" | "PARTIAL" | "DIRECT"; qtyDelivered: number; qtyTotal: number }> {
    // If scoped to a call-off, only consider lines on that call-off, and use
    // requestedQty as the universe; subtract only prior DNs scoped to this call-off.
    const callOff = callOffId ? callOffs.find((c) => c.id === callOffId) : null;
    const requestedByLine = new Map<string, number>();
    if (callOff) {
      for (const cl of callOff.lines) {
        requestedByLine.set(
          cl.ticketLineId,
          (requestedByLine.get(cl.ticketLineId) ?? 0) + Number(cl.requestedQty)
        );
      }
    }

    const deliveredByLine = new Map<string, number>();
    for (const dn of prior) {
      if (callOffId && dn.callOffId !== callOffId) continue; // scoped: only count this call-off's DNs
      for (const dl of dn.lines) {
        deliveredByLine.set(
          dl.ticketLineId,
          (deliveredByLine.get(dl.ticketLineId) ?? 0) + Number(dl.qtyDelivered)
        );
      }
    }

    const items: Record<string, { status: "DELIVERED" | "BACK_ORDER" | "NOT_ORDERED" | "PARTIAL" | "DIRECT"; qtyDelivered: number; qtyTotal: number }> = {};
    for (const l of orderedTicketLines) {
      if (callOff && !requestedByLine.has(l.id)) continue; // not on this call-off
      const universe = callOff ? (requestedByLine.get(l.id) ?? 0) : physicalQty(l);
      const alreadyDelivered = deliveredByLine.get(l.id) ?? 0;
      const remaining = Math.max(0, universe - alreadyDelivered);
      if (remaining === 0) continue; // fully delivered already
      if (l.status === "PARTIALLY_ORDERED") {
        items[l.id] = { status: "BACK_ORDER", qtyDelivered: 0, qtyTotal: remaining };
      } else if (
        l.status === "ORDERED" || l.status === "FROM_STOCK" || l.status === "PARTIALLY_COSTED" ||
        l.status === "FULLY_COSTED" || l.status === "INVOICED"
      ) {
        items[l.id] = { status: "DELIVERED", qtyDelivered: remaining, qtyTotal: remaining };
      } else {
        items[l.id] = { status: "NOT_ORDERED", qtyDelivered: 0, qtyTotal: remaining };
      }
    }
    return items;
  }

  async function openDeliveryNote(scope: string = dnCallOffId) {
    const prior = await loadPriorDeliveryNotes();
    setDnCallOffId(scope);
    setDeliveryItems(computeDeliveryItems(prior, scope));
    setDeliveryNoteOpen(true);
  }

  function changeDnScope(scope: string) {
    setDnCallOffId(scope);
    setDeliveryItems(computeDeliveryItems(priorDeliveryNotes, scope));
  }

  // ── Procurement checklist (stock vs order) ──
  function findStockMatch(line: TicketLineOption): { id: string; avail: number } | null {
    if (!stockItems.length) return null;
    const normLine = normalizeDesc(line.description);
    const lineTokens = normLine.split(" ").filter((t) => t.length > 1);
    let best: { id: string; avail: number } | null = null;
    for (const si of stockItems) {
      const avail = Number(si.qtyOnHand?.toString() || 0);
      if (avail <= 0) continue;
      const normStock = normalizeDesc(si.description);
      const stockTokens = normStock.split(" ").filter((t) => t.length > 1);
      const overlap = lineTokens.filter((t) => stockTokens.includes(t)).length;
      const score = lineTokens.length > 0 ? overlap / lineTokens.length : 0;
      if (score >= 0.7 || normLine.includes(normStock) || normStock.includes(normLine)) {
        if (!best || avail > best.avail) best = { id: si.id, avail };
      }
    }
    return best;
  }

  function computeProcItems(callOffId: string) {
    const callOff = callOffId ? callOffs.find((c) => c.id === callOffId) : null;
    const requestedByLine = new Map<string, number>();
    if (callOff) {
      for (const cl of callOff.lines) {
        requestedByLine.set(cl.ticketLineId, (requestedByLine.get(cl.ticketLineId) ?? 0) + Number(cl.requestedQty));
      }
    }
    const poLineIds = new Set(
      procurementOrders.flatMap((po) => po.lines.map((l) => l.ticketLine?.id).filter(Boolean))
    );
    const items: Record<string, { action: "ORDER" | "SPLIT" | "STOCK" | "SKIP"; qtyTotal: number; qtyStock: number; stockItemId: string | null; stockAvail: number }> = {};
    for (const l of orderedTicketLines) {
      if (l.isBomParent) continue;
      if (callOff && !requestedByLine.has(l.id)) continue;
      const qtyTotal = callOff ? (requestedByLine.get(l.id) ?? 0) : physicalQty(l);
      if (qtyTotal <= 0) continue;
      const match = findStockMatch(l);
      const alreadyHandled = poLineIds.has(l.id) || ["ORDERED", "FROM_STOCK", "INVOICED", "CLOSED"].includes(l.status);
      items[l.id] = {
        action: alreadyHandled ? "SKIP" : "ORDER",
        qtyTotal,
        qtyStock: match ? Math.min(match.avail, qtyTotal) : 0,
        stockItemId: match?.id ?? null,
        stockAvail: match?.avail ?? 0,
      };
    }
    return items;
  }

  function openProcurement(scope?: string) {
    const def = scope ?? ([...callOffs].reverse().find((c) => c.status === "OPEN")?.id ?? "");
    setProcCallOffId(def);
    setProcItems(computeProcItems(def));
    setProcOpen(true);
  }

  function changeProcScope(scope: string) {
    setProcCallOffId(scope);
    setProcItems(computeProcItems(scope));
  }

  function procSplit(it: { action: string; qtyTotal: number; qtyStock: number }) {
    const stock = it.action === "STOCK" ? it.qtyTotal : it.action === "SPLIT" ? Math.min(Math.max(0, it.qtyStock), it.qtyTotal) : 0;
    const order = it.action === "ORDER" ? it.qtyTotal : it.action === "SPLIT" ? Math.max(0, it.qtyTotal - stock) : 0;
    return { stock, order };
  }

  function printProcurement() {
    const callOff = procCallOffId ? callOffs.find((c) => c.id === procCallOffId) : null;
    const lines = orderedTicketLines.filter((l) => !l.isBomParent && procItems[l.id] && procItems[l.id].action !== "SKIP");
    const bySupplier: Record<string, number> = {};
    let totalStock = 0, totalOrder = 0;
    const rows = lines.map((line) => {
      const it = procItems[line.id];
      const { stock, order } = procSplit(it);
      totalStock += stock; totalOrder += order;
      if (order > 0) { const k = line.supplierName || "(no supplier)"; bySupplier[k] = (bySupplier[k] || 0) + order; }
      const label = it.action === "ORDER" ? "Order" : it.action === "STOCK" ? "Stock" : "Split";
      const color = it.action === "ORDER" ? "#b45309" : it.action === "STOCK" ? "#047857" : "#1d4ed8";
      return `<tr>
        <td style="width:24px;text-align:center">☐</td>
        <td>${line.description}${line.internalNotes ? `<div style="font-size:9px;color:#b45309">📝 ${line.internalNotes}</div>` : ""}</td>
        <td style="text-align:right">${it.qtyTotal}</td>
        <td>${line.unit}</td>
        <td style="text-align:right;color:#047857">${stock || "—"}</td>
        <td style="text-align:right;color:#b45309">${order || "—"}</td>
        <td style="font-weight:700;color:${color}">${label}</td>
        <td>${line.supplierName || "—"}</td>
      </tr>`;
    }).join("");
    const supplierRows = Object.entries(bySupplier)
      .sort((a, b) => b[1] - a[1])
      .map(([s, q]) => `<tr><td>${s}</td><td style="text-align:right">${q}</td></tr>`).join("");
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; } .sub { font-size:11px; color:#555; margin-top:2px; }
      h2 { font-size:12px; text-transform:uppercase; letter-spacing:0.5px; margin-top:20px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      .ref { font-size:13px; font-weight:600; margin-top:12px; }
      .meta { font-size:11px; color:#555; margin-top:2px; margin-bottom:16px; }
      table { width:100%; border-collapse:collapse; margin-top:8px; }
      th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; }
      .summary { margin-top:12px; font-size:11px; display:flex; gap:30px; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Procurement Checklist</div>
      <hr />
      <div class="ref">${ticketTitle}</div>
      <div class="meta">Date: ${dateStr}${callOff ? ` &nbsp;·&nbsp; Call-off <b>CO${callOff.coSeq ?? callOff.callOffNo}</b> (PO ${callOff.customerPO.poNo})` : (customerPONo ? ` &nbsp;·&nbsp; Customer PO: <b>${customerPONo}</b>` : "")}</div>
      <table>
        <thead><tr><th style="width:24px"></th><th>Description</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Stock</th><th style="text-align:right">Order</th><th>Action</th><th>Supplier</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><b>Lines:</b> ${lines.length}</div>
        <div><b>From stock:</b> ${totalStock}</div>
        <div><b>To order:</b> ${totalOrder}</div>
      </div>
      ${supplierRows ? `<h2>Order by supplier</h2><table><thead><tr><th>Supplier</th><th style="text-align:right">Units to order</th></tr></thead><tbody>${supplierRows}</tbody></table>` : ""}
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  async function submitProcurement() {
    setProcSubmitting(true);
    try {
      const orderLines: Array<{ line: TicketLineOption; qty: number }> = [];
      const stockAllocs: Array<{ line: TicketLineOption; stockItemId: string; qty: number }> = [];
      for (const [lineId, it] of Object.entries(procItems)) {
        const line = ticketLines.find((l) => l.id === lineId);
        if (!line) continue;
        if (it.action === "ORDER") {
          orderLines.push({ line, qty: it.qtyTotal });
        } else if (it.action === "STOCK" && it.stockItemId) {
          stockAllocs.push({ line, stockItemId: it.stockItemId, qty: it.qtyTotal });
        } else if (it.action === "SPLIT") {
          const stockQty = Math.min(Math.max(0, it.qtyStock), it.qtyTotal);
          const orderQty = it.qtyTotal - stockQty;
          if (it.stockItemId && stockQty > 0) stockAllocs.push({ line, stockItemId: it.stockItemId, qty: stockQty });
          if (orderQty > 0) orderLines.push({ line, qty: orderQty });
        }
        // SKIP -> nothing
      }

      // Order lines -> supplier POs grouped by supplier
      const bySupplier: Record<string, Array<{ line: TicketLineOption; qty: number }>> = {};
      for (const ol of orderLines) {
        const key = ol.line.supplierName || "(no supplier)";
        (bySupplier[key] ??= []).push(ol);
      }
      for (const [supplierName, lines] of Object.entries(bySupplier)) {
        const sup = suppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase());
        const poNo = `PO-${Date.now()}-${supplierName.substring(0, 4).toUpperCase().replace(/\s/g, "")}`;
        await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticketId,
            supplierId: sup?.id || undefined,
            poNo,
            lines: lines.map(({ line, qty }) => ({
              ticketLineId: line.id,
              description: line.description,
              qty,
              unitCost: Number(line.expectedCostUnit?.toString() || 0),
              lineTotal: qty * Number(line.expectedCostUnit?.toString() || 0),
            })),
          }),
        });
      }

      // Stock allocations
      for (const sa of stockAllocs) {
        await fetch(`/api/stock/${sa.stockItemId}/use`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketLineId: sa.line.id, qtyUsed: sa.qty }),
        });
      }

      // Status: any ordered qty -> ORDERED; pure-stock -> FROM_STOCK
      const orderedSet = new Set(orderLines.map((o) => o.line.id));
      for (const id of orderedSet) {
        await fetch(`/api/ticket-lines/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "ORDERED" }) });
      }
      for (const [lineId, it] of Object.entries(procItems)) {
        if (it.action === "STOCK" && !orderedSet.has(lineId)) {
          await fetch(`/api/ticket-lines/${lineId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "FROM_STOCK" }) });
        }
      }

      setProcOpen(false);
      router.refresh();
    } finally {
      setProcSubmitting(false);
    }
  }

  async function printDeliveryNote() {
    // Only lines actually in scope for this delivery (in deliveryItems). Lines
    // fully delivered on prior DNs were dropped in openDeliveryNote().
    const printable = orderedTicketLines.filter((l) => !l.isBomParent && deliveryItems[l.id]);
    const statusOf = (l: TicketLineOption) => deliveryItems[l.id]?.status ?? "DELIVERED";
    const physicalLines = printable.filter((l) => ["DELIVERED", "PARTIAL", "BACK_ORDER"].includes(statusOf(l)));
    const directLines = printable.filter((l) => statusOf(l) === "DIRECT");

    let deliveryNo: number | null = null;
    const persistLines = physicalLines
      .map((l) => {
        const item = deliveryItems[l.id];
        if (!item) return null;
        const status = item.status as "DELIVERED" | "PARTIAL" | "BACK_ORDER";
        return {
          ticketLineId: l.id,
          qtyDelivered: item.qtyDelivered,
          qtyBackOrder: Math.max(0, item.qtyTotal - item.qtyDelivered),
          status,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);

    if (persistLines.length > 0) {
      try {
        const res = await fetch(`/api/tickets/${ticketId}/delivery-notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deliveryDate,
            lines: persistLines,
            callOffId: dnCallOffId || undefined,
          }),
        });
        if (res.ok) {
          const saved = await res.json();
          deliveryNo = saved.deliveryNo ?? null;
        }
      } catch {
        // proceed with printing even if persistence fails
      }
    }

    const dnCallOff = dnCallOffId ? callOffs.find((c) => c.id === dnCallOffId) : null;

    const renderPhysicalRow = (line: TicketLineOption, prev: TicketLineOption | null) => {
      const item = deliveryItems[line.id] || { status: "DELIVERED" as const, qtyDelivered: physicalQty(line), qtyTotal: physicalQty(line) };
      const backQty = item.qtyTotal - item.qtyDelivered;
      const prevSection = prev?.sectionLabel ?? null;
      const sectionRow = line.sectionLabel && line.sectionLabel !== prevSection
        ? `<tr><td colspan="6" style="background:#eee;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;padding:8px">${line.sectionLabel}</td></tr>`
        : "";
      const bomHeaderRow = line.parentLineId && line.parentDescription && (!prev || prev.parentLineId !== line.parentLineId)
        ? `<tr><td colspan="6" style="background:#eef5ff;color:#1d4ed8;font-weight:700;font-size:10px;padding:6px 8px;border-top:1px solid #3399FF">BOM: ${line.parentDescription}${line.parentQty ? ` × ${line.parentQty}` : ""}</td></tr>`
        : "";
      const statusLabel = item.status === "DELIVERED" ? "✓ Delivered"
        : item.status === "PARTIAL" ? `✓ ${item.qtyDelivered} delivered / ${backQty} back order`
        : "⏳ Back Order";
      const color = item.status === "DELIVERED" ? "#000" : "#FF6600";
      const descCell = (line.parentLineId
        ? `<span style="color:#3399FF;margin-right:6px">└</span>${line.description}`
        : line.description)
        + (line.substitutedFrom ? `<div style="font-size:9px;color:#7c3aed;font-weight:600">🔄 substitute for ${line.substitutedFrom}</div>` : "");
      return `${sectionRow}${bomHeaderRow}<tr>
        <td style="width:24px;text-align:center">${item.status === "BACK_ORDER" ? "☐" : "☑"}</td>
        <td${line.parentLineId ? ' style="padding-left:18px"' : ""}>${descCell}</td>
        <td style="text-align:right">${item.qtyDelivered > 0 ? item.qtyDelivered : "—"}</td>
        <td style="text-align:right;color:#FF6600">${backQty > 0 ? backQty : ""}</td>
        <td>${line.unit}</td>
        <td style="font-size:10px;font-weight:bold;color:${color}">${statusLabel}</td>
      </tr>`;
    };

    const renderDirectRow = (line: TicketLineOption, prev: TicketLineOption | null) => {
      const item = deliveryItems[line.id] || { status: "DIRECT" as const, qtyDelivered: physicalQty(line), qtyTotal: physicalQty(line) };
      const prevSection = prev?.sectionLabel ?? null;
      const sectionRow = line.sectionLabel && line.sectionLabel !== prevSection
        ? `<tr><td colspan="5" style="background:#eee;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;padding:8px">${line.sectionLabel}</td></tr>`
        : "";
      const bomHeaderRow = line.parentLineId && line.parentDescription && (!prev || prev.parentLineId !== line.parentLineId)
        ? `<tr><td colspan="5" style="background:#eef5ff;color:#1d4ed8;font-weight:700;font-size:10px;padding:6px 8px;border-top:1px solid #3399FF">BOM: ${line.parentDescription}${line.parentQty ? ` × ${line.parentQty}` : ""}</td></tr>`
        : "";
      const descCell = (line.parentLineId
        ? `<span style="color:#3399FF;margin-right:6px">└</span>${line.description}`
        : line.description)
        + (line.substitutedFrom ? `<div style="font-size:9px;color:#7c3aed;font-weight:600">🔄 substitute for ${line.substitutedFrom}</div>` : "");
      return `${sectionRow}${bomHeaderRow}<tr>
        <td style="width:24px;text-align:center;color:#3399FF">↗</td>
        <td${line.parentLineId ? ' style="padding-left:18px"' : ""}>${descCell}</td>
        <td style="text-align:right">${item.qtyTotal}</td>
        <td>${line.unit}</td>
        <td style="font-size:10px;font-weight:bold;color:#3399FF">${line.supplierName ? `↗ ${line.supplierName}` : "↗ Direct from supplier"}</td>
      </tr>`;
    };

    const rows = physicalLines.map((line, i) => renderPhysicalRow(line, i > 0 ? physicalLines[i - 1] : null)).join("");
    const directRows = directLines.map((line, i) => renderDirectRow(line, i > 0 ? directLines[i - 1] : null)).join("");

    const deliveredCount = physicalLines.filter((l) => deliveryItems[l.id]?.status === "DELIVERED").length;
    const directCount = directLines.length;
    const partialCount = physicalLines.filter((l) => deliveryItems[l.id]?.status === "PARTIAL").length;
    const backOrderCount = physicalLines.filter((l) => deliveryItems[l.id]?.status === "BACK_ORDER").length;

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
      <div class="sub">Delivery Note${deliveryNo != null ? ` #${deliveryNo}` : ""}</div>
      <hr />
      <div class="ref">${ticketTitle}</div>
      <div class="meta">Date: ${new Date(deliveryDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}${dnCallOff ? ` &nbsp;·&nbsp; Call-off <b>CO${dnCallOff.coSeq ?? dnCallOff.callOffNo}</b> (PO ${dnCallOff.customerPO.poNo})` : (customerPONo ? ` &nbsp;·&nbsp; Customer PO: <b>${customerPONo}</b>` : "")}</div>
      ${physicalLines.length > 0 ? `
      <div style="font-size:12px;font-weight:700;margin-top:8px;text-transform:uppercase;letter-spacing:0.5px">Delivered by Cromwell</div>
      <table>
        <thead><tr><th style="width:24px"></th><th>Description</th><th style="text-align:right">Delivered</th><th style="text-align:right;color:#FF6600">Back Order</th><th>Unit</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><b>Delivered:</b> ${deliveredCount}</div>
        <div><b>Partial:</b> ${partialCount}</div>
        <div><b>Back Order:</b> ${backOrderCount}</div>
        <div><b>Total Lines:</b> ${physicalLines.length}</div>
      </div>
      <div class="sig">
        <div class="sig-box">Received By (Print Name)</div>
        <div class="sig-box">Signature</div>
        <div class="sig-box">Date</div>
      </div>` : ""}
      ${directLines.length > 0 ? `
      <div style="margin-top:${physicalLines.length > 0 ? "40px" : "8px"};background:#eef5ff;color:#1d4ed8;padding:8px 10px;font-weight:700;font-size:11px">
        ↗ Direct from supplier — shipped separately, not part of this Cromwell delivery
      </div>
      <table>
        <thead><tr><th style="width:24px"></th><th>Description</th><th style="text-align:right">Qty</th><th>Unit</th><th>Supplier</th></tr></thead>
        <tbody>${directRows}</tbody>
      </table>
      <div class="summary"><div><b>Direct lines:</b> ${directCount}</div></div>` : ""}
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
    if (deliveryNo != null) {
      setDeliveryNoteOpen(false);
      void loadPriorDeliveryNotes();
      router.refresh();
    }
  }

  function reprintDeliveryNote(dn: (typeof priorDeliveryNotes)[number]) {
    const lineById = new Map(ticketLines.map((l) => [l.id, l] as const));
    const dateStr = new Date(dn.deliveryDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const rowsHtml = dn.lines.map((dl) => {
      const tl = lineById.get(dl.ticketLineId);
      const desc = tl?.description ?? "(line removed)";
      const unit = tl?.unit ?? "EA";
      const qd = Number(dl.qtyDelivered);
      const bo = Number(dl.qtyBackOrder);
      const statusLabel = dl.status === "DELIVERED" ? "✓ Delivered"
        : dl.status === "PARTIAL" ? `✓ ${qd} delivered / ${bo} back order`
        : "⏳ Back Order";
      const color = dl.status === "DELIVERED" ? "#000" : "#FF6600";
      return `<tr>
        <td style="width:24px;text-align:center">${dl.status === "BACK_ORDER" ? "☐" : "☑"}</td>
        <td>${desc}${tl?.substitutedFrom ? `<div style="font-size:9px;color:#7c3aed;font-weight:600">🔄 substitute for ${tl.substitutedFrom}</div>` : ""}${dl.note ? `<div style="font-size:9px;color:#666;font-style:italic;margin-top:1px">${dl.note}</div>` : ""}</td>
        <td style="text-align:right">${qd > 0 ? qd : "—"}</td>
        <td style="text-align:right;color:#FF6600">${bo > 0 ? bo : ""}</td>
        <td>${unit}</td>
        <td style="font-size:10px;font-weight:bold;color:${color}">${statusLabel}</td>
      </tr>`;
    }).join("");
    const deliveredCount = dn.lines.filter((l) => l.status === "DELIVERED").length;
    const partialCount = dn.lines.filter((l) => l.status === "PARTIAL").length;
    const backOrderCount = dn.lines.filter((l) => l.status === "BACK_ORDER").length;

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
      <div class="sub">Delivery Note #${dn.deliveryNo}</div>
      <hr />
      <div class="ref">${ticketTitle}</div>
      <div class="meta">Date: ${dateStr}${customerPONo ? ` &nbsp;·&nbsp; Customer PO: <b>${customerPONo}</b>` : ""}</div>
      ${dn.notes ? `<div style="font-size:11px;margin-top:8px;padding:8px 10px;border-left:3px solid #FF6600;background:#FFF7F0"><b>Notes:</b><br>${dn.notes.replace(/\n/g, "<br>")}</div>` : ""}
      <div style="font-size:12px;font-weight:700;margin-top:8px;text-transform:uppercase;letter-spacing:0.5px">Delivered by Cromwell</div>
      <table>
        <thead><tr><th style="width:24px"></th><th>Description</th><th style="text-align:right">Delivered</th><th style="text-align:right;color:#FF6600">Back Order</th><th>Unit</th><th>Status</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="summary">
        <div><b>Delivered:</b> ${deliveredCount}</div>
        <div><b>Partial:</b> ${partialCount}</div>
        <div><b>Back Order:</b> ${backOrderCount}</div>
        <div><b>Total Lines:</b> ${dn.lines.length}</div>
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
      const prevSection = i > 0 ? needsPurchase[i - 1].sectionLabel : null;
      const sectionRow = line.sectionLabel && line.sectionLabel !== prevSection
        ? `<tr><td colspan="5" style="background:#eee;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:1px;padding:8px">${line.sectionLabel}</td></tr>`
        : "";
      return `${sectionRow}<tr>
        <td style="text-align:center;width:30px"><input type="checkbox" style="width:14px;height:14px" /></td>
        <td>${line.description}${line.internalNotes ? `<div style="font-size:9px;color:#b45309">📝 ${line.internalNotes}</div>` : ""}</td>
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
      const res = await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
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
      {/* Prior Delivery Notes — history list */}
      {priorDeliveryNotes.length > 0 && (
        <div className="border border-[#2A2A2A] bg-[#0A0A0A] mb-2">
          <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-[#888888] bb-mono border-b border-[#2A2A2A]">
            Delivery Notes ({priorDeliveryNotes.length})
          </div>
          <table className="w-full text-[11px] bb-mono">
            <thead className="text-[#888888] uppercase">
              <tr>
                <th className="text-left px-3 py-1.5">#</th>
                <th className="text-left px-3 py-1.5">Date</th>
                <th className="text-right px-3 py-1.5">Delivered</th>
                <th className="text-right px-3 py-1.5">Partial</th>
                <th className="text-right px-3 py-1.5">Back Order</th>
                <th className="text-right px-3 py-1.5">Lines</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {priorDeliveryNotes.map((dn) => {
                const delivered = dn.lines.filter((l) => l.status === "DELIVERED").length;
                const partial = dn.lines.filter((l) => l.status === "PARTIAL").length;
                const backOrder = dn.lines.filter((l) => l.status === "BACK_ORDER").length;
                return (
                  <tr key={dn.id} className="border-t border-[#222222]">
                    <td className="px-3 py-1.5 text-[#CCCCCC]">DN-{dn.deliveryNo}</td>
                    <td className="px-3 py-1.5 text-[#CCCCCC]">
                      {new Date(dn.deliveryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#00CC66]">{delivered}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#FF9900]">{partial || ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#FF6600]">{backOrder || ""}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-[#888888]">{dn.lines.length}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => reprintDeliveryNote(dn)}
                        className="text-[10px] text-[#FF6600] hover:underline bb-mono"
                      >
                        REPRINT
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delivery Note — always available */}
      <div className="flex justify-end gap-2 mb-2">
        <Button size="sm" variant="outline" onClick={() => openProcurement()}>
          Procurement
        </Button>
        <Button size="sm" variant="outline" onClick={() => void openDeliveryNote()}>
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
          <div className="flex items-center gap-2 px-4 mb-3 flex-wrap">
            <Label className="text-xs text-[#888888]">Delivery Date:</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="w-40 h-7 text-xs"
            />
            {callOffs.length > 0 && (
              <>
                <Label className="text-xs text-[#888888] ml-2">Scope:</Label>
                <select
                  value={dnCallOffId}
                  onChange={(e) => changeDnScope(e.target.value)}
                  className="h-7 text-xs rounded border bg-background px-2"
                >
                  <option value="">All ticket lines</option>
                  {callOffs.map((co) => (
                    <option key={co.id} value={co.id}>
                      Call-off CO{co.coSeq ?? co.callOffNo} — PO {co.customerPO.poNo} ({co.status})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {priorDeliveryNotes.length > 0 && (
            <div className="px-4 mb-2 text-[10px] text-[#888888]">
              {dnCallOffId
                ? (() => {
                    const c = priorDeliveryNotes.filter((dn) => dn.callOffId === dnCallOffId).length;
                    return c === 0
                      ? "No prior delivery notes on this call-off."
                      : `${c} prior delivery note${c === 1 ? "" : "s"} on this call-off — only outstanding qty is shown below.`;
                  })()
                : `${priorDeliveryNotes.length} prior delivery note${priorDeliveryNotes.length === 1 ? "" : "s"} on this ticket — only outstanding qty is shown below.`}
            </div>
          )}
          <div className="flex flex-col gap-1 px-4 flex-1 overflow-y-auto max-h-[70vh]">
            {(() => {
              const sheetLines = orderedTicketLines.filter((l) => !l.isBomParent && deliveryItems[l.id]);
              if (sheetLines.length === 0) {
                return <div className="text-xs text-[#888888] py-6 text-center">All ordered lines fully delivered.</div>;
              }
              return sheetLines.map((line, idx) => {
              const prev = idx > 0 ? sheetLines[idx - 1] : null;
              const showBomHeader = line.parentLineId && line.parentDescription && (!prev || prev.parentLineId !== line.parentLineId);
              const item = deliveryItems[line.id] || { status: "DELIVERED" as const, qtyDelivered: physicalQty(line), qtyTotal: physicalQty(line) };
              const bgColor = item.status === "DELIVERED" ? "bg-[#00CC66]/10 border-[#00CC66]/30"
                : item.status === "DIRECT" ? "bg-[#3399FF]/10 border-[#3399FF]/30"
                : item.status === "PARTIAL" ? "bg-[#FF9900]/10 border-[#FF9900]/30"
                : item.status === "BACK_ORDER" ? "bg-[#FF3333]/10 border-[#FF3333]/30"
                : "bg-[#333333]/10 border-[#333333] opacity-50";
              return (
                <React.Fragment key={line.id}>
                  {showBomHeader && (
                    <div className="text-[10px] uppercase tracking-widest font-bold text-[#3399FF] mt-2 px-1">
                      BOM: {line.parentDescription}{line.parentQty ? ` × ${line.parentQty.toString()}` : ""}
                    </div>
                  )}
                <div className={`p-2 border ${bgColor}${line.parentLineId ? " ml-3" : ""}`}>
                  <div className="flex items-start gap-1 mb-1">
                    <span className="text-xs flex-1 font-medium">{line.description}</span>
                    <span className="text-[10px] text-[#888888] tabular-nums whitespace-nowrap flex-shrink-0">{item.qtyTotal} {line.unit}</span>
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
                    <Button size="sm" variant={item.status === "DIRECT" ? "default" : "outline"}
                      className={`h-5 text-[9px] px-2 ${item.status === "DIRECT" ? "bg-[#3399FF] text-white" : ""}`}
                      onClick={() => setDeliveryItems((prev) => ({ ...prev, [line.id]: { ...item, status: "DIRECT", qtyDelivered: item.qtyTotal } }))}
                    >Direct</Button>
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
                </React.Fragment>
              );
              });
            })()}
          </div>
          <SheetFooter>
            <div className="flex gap-2 px-4">
              <Button variant="outline" size="sm" onClick={() => {
                setDeliveryItems((prev) => {
                  const next: typeof deliveryItems = {};
                  for (const [lineId, item] of Object.entries(prev)) {
                    next[lineId] = { ...item, status: "DELIVERED", qtyDelivered: item.qtyTotal };
                  }
                  return next;
                });
              }}>All Delivered</Button>
              <Button onClick={printDeliveryNote} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                Print Delivery Note
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Interactive Procurement Checklist Sheet */}
      <Sheet open={procOpen} onOpenChange={setProcOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Procurement checklist</SheetTitle>
            <SheetDescription>Mark each item as order, stock, or split, then raise POs.</SheetDescription>
          </SheetHeader>
          <div className="flex items-center gap-2 px-4 mb-3 flex-wrap">
            {callOffs.length > 0 && (
              <>
                <Label className="text-xs text-[#888888]">Scope:</Label>
                <select
                  value={procCallOffId}
                  onChange={(e) => changeProcScope(e.target.value)}
                  className="h-7 text-xs rounded border bg-background px-2"
                >
                  <option value="">All ticket lines</option>
                  {callOffs.map((co) => (
                    <option key={co.id} value={co.id}>
                      Call-off CO{co.coSeq ?? co.callOffNo} — PO {co.customerPO.poNo} ({co.status})
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          {(() => {
            const its = Object.values(procItems);
            const orderCount = its.filter((i) => i.action === "ORDER" || i.action === "SPLIT").length;
            const stockUnits = its.reduce((s, i) => s + (i.action === "STOCK" ? i.qtyTotal : i.action === "SPLIT" ? Math.min(i.qtyStock, i.qtyTotal) : 0), 0);
            return (
              <div className="px-4 mb-2 text-[10px] text-[#888888]">
                {orderCount} line{orderCount === 1 ? "" : "s"} to order · {stockUnits} unit{stockUnits === 1 ? "" : "s"} from stock
              </div>
            );
          })()}
          <div className="flex flex-col gap-1 px-4 flex-1 overflow-y-auto max-h-[70vh]">
            {(() => {
              const sheetLines = orderedTicketLines.filter((l) => !l.isBomParent && procItems[l.id]);
              if (sheetLines.length === 0) {
                return <div className="text-xs text-[#888888] py-6 text-center">No lines to procure for this scope.</div>;
              }
              return sheetLines.map((line) => {
                const item = procItems[line.id];
                const bgColor = item.action === "ORDER" ? "bg-[#FF9900]/10 border-[#FF9900]/30"
                  : item.action === "STOCK" ? "bg-[#00CC66]/10 border-[#00CC66]/30"
                  : item.action === "SPLIT" ? "bg-[#3399FF]/10 border-[#3399FF]/30"
                  : "bg-[#333333]/10 border-[#333333] opacity-50";
                const set = (patch: Partial<typeof item>) =>
                  setProcItems((prev) => ({ ...prev, [line.id]: { ...prev[line.id], ...patch } }));
                return (
                  <div key={line.id} className={`p-2 border ${bgColor}`}>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs flex-1 truncate font-medium">{line.description}</span>
                      <span className="text-[10px] text-[#888888] tabular-nums whitespace-nowrap">{item.qtyTotal} {line.unit}</span>
                      {item.stockAvail > 0 && (
                        <span className="text-[9px] text-[#00CC66] whitespace-nowrap">{item.stockAvail} stock</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant={item.action === "ORDER" ? "default" : "outline"}
                        className={`h-5 text-[9px] px-2 ${item.action === "ORDER" ? "bg-[#FF9900] text-black" : ""}`}
                        onClick={() => set({ action: "ORDER" })}
                      >Order</Button>
                      <Button size="sm" variant={item.action === "SPLIT" ? "default" : "outline"}
                        className={`h-5 text-[9px] px-2 ${item.action === "SPLIT" ? "bg-[#3399FF] text-white" : ""}`}
                        onClick={() => set({ action: "SPLIT", qtyStock: item.qtyStock > 0 && item.qtyStock < item.qtyTotal ? item.qtyStock : (item.stockAvail > 0 ? Math.min(item.stockAvail, item.qtyTotal - 1) : Math.max(1, Math.floor(item.qtyTotal / 2))) })}
                      >Split</Button>
                      <Button size="sm" variant={item.action === "STOCK" ? "default" : "outline"}
                        className={`h-5 text-[9px] px-2 ${item.action === "STOCK" ? "bg-[#00CC66] text-black" : ""}`}
                        onClick={() => set({ action: "STOCK" })}
                      >Stock</Button>
                      <Button size="sm" variant={item.action === "SKIP" ? "default" : "outline"}
                        className={`h-5 text-[9px] px-2 ${item.action === "SKIP" ? "bg-[#666666] text-white" : ""}`}
                        onClick={() => set({ action: "SKIP" })}
                      >Skip</Button>
                      {item.action === "SPLIT" && (
                        <>
                          <Input
                            type="number"
                            min={1}
                            max={item.qtyTotal - 1}
                            value={item.qtyStock}
                            onChange={(e) => set({ qtyStock: Math.max(0, Math.min(Number(e.target.value) || 0, item.qtyTotal)) })}
                            className="h-5 w-16 text-[10px] text-center px-1"
                            title="Qty from stock — rest is ordered"
                          />
                          <span className="text-[9px] text-[#3399FF] whitespace-nowrap">
                            {Math.min(item.qtyStock, item.qtyTotal)} stk / {Math.max(0, item.qtyTotal - Math.min(item.qtyStock, item.qtyTotal))} ord
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
          <SheetFooter>
            <div className="flex gap-2 px-4">
              <Button variant="outline" size="sm" onClick={() =>
                setProcItems((prev) => {
                  const next: typeof prev = {};
                  for (const [id, it] of Object.entries(prev)) next[id] = { ...it, action: "ORDER" };
                  return next;
                })
              }>All Order</Button>
              <Button variant="outline" size="sm" onClick={printProcurement}>Print</Button>
              <Button onClick={() => void submitProcurement()} disabled={procSubmitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                {procSubmitting ? "Working…" : "Raise POs & Allocate"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Stock Suggestions Banner */}
      {showChecklist && stockMatches.length > 0 && (
        <div className="border border-[#FF6600]/40 bg-[#FF6600]/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Package className="size-5 text-[#FF6600]" />
            <h3 className="text-[11px] uppercase tracking-widest text-[#FF6600] font-bold">
              Stock Available — {stockMatches.length} match{stockMatches.length !== 1 ? "es" : ""} found
            </h3>
          </div>
          <p className="text-xs text-[#CCCCCC]">
            These holding items match lines on this order. Allocate from stock to reduce purchasing.
          </p>
          <div className="space-y-2">
            {stockMatches.map((m) => {
              const canFullyCover = m.stockQty >= m.lineQty;
              return (
                <div key={`${m.lineId}-${m.stockId}`} className="flex items-center justify-between border border-[#333333] bg-[#1A1A1A] px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-[#E0E0E0]">{m.lineDesc}</div>
                    <div className="text-[10px] text-[#888888] mt-0.5">
                      Need {m.lineQty} {m.lineUnit} &middot; Stock: <span className="text-[#FF6600] font-medium">{m.stockDesc}</span> — {m.stockQty} {m.stockUnit} @ £{m.stockCost.toFixed(2)}
                    </div>
                    <div className="text-[10px] mt-0.5">
                      {canFullyCover ? (
                        <span className="text-[#00CC66]">Full coverage from stock</span>
                      ) : (
                        <span className="text-[#FF9900]">Partial — {m.stockQty} from stock, order {m.lineQty - m.stockQty}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-[#FF6600] text-black hover:bg-[#CC5500] ml-3 shrink-0"
                    onClick={() => {
                      setStockPickerLine(m.lineId);
                      setStockPickerItemId(m.stockId);
                      setStockPickerQty(String(Math.min(m.stockQty, m.lineQty)));
                    }}
                  >
                    <Package className="size-3.5 mr-1" />
                    Allocate
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                    <SelectItem key={s.id} value={s.id} label={s.name}>{s.name}</SelectItem>
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
              {(() => {
                const selectedLines = needsPurchase.filter(l => selectedForPurchase.has(l.id));
                const withSupplier = selectedLines.filter(l => l.supplierName);
                const supplierCount = new Set(withSupplier.map(l => l.supplierName)).size;
                if (withSupplier.length === 0) return null;
                return (
                  <Button
                    size="sm"
                    className="bg-[#FF6600] text-black hover:bg-[#FF8833] h-7 text-xs font-bold"
                    disabled={bulkProcessing}
                    onClick={async () => {
                      setBulkProcessing(true);
                      try {
                        // Group by supplier
                        const grouped: Record<string, typeof selectedLines> = {};
                        for (const line of withSupplier) {
                          const key = line.supplierName!;
                          if (!grouped[key]) grouped[key] = [];
                          grouped[key].push(line);
                        }
                        for (const [supplierName, lines] of Object.entries(grouped)) {
                          const sup = suppliers.find(s => s.name.toLowerCase() === supplierName.toLowerCase());
                          const poNo = `PO-${Date.now()}-${supplierName.substring(0, 3).toUpperCase()}`;
                          await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              ticketId,
                              supplierId: sup?.id || undefined,
                              supplierName: sup ? undefined : supplierName,
                              poNo,
                              lines: lines.map(l => ({
                                ticketLineId: l.id,
                                description: l.description,
                                qty: Number(l.qty?.toString() || 1),
                                unitCost: Number(l.expectedCostUnit?.toString() || 0),
                                lineTotal: Number(l.qty?.toString() || 1) * Number(l.expectedCostUnit?.toString() || 0),
                              })),
                            }),
                          });
                          // Mark lines as ordered
                          for (const line of lines) {
                            await fetch(`/api/ticket-lines/${line.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ status: "ORDERED" }),
                            });
                          }
                        }
                        setSelectedForPurchase(new Set());
                        setBulkSupplierId("");
                        router.refresh();
                      } finally {
                        setBulkProcessing(false);
                      }
                    }}
                  >
                    Auto PO ({supplierCount} supplier{supplierCount !== 1 ? "s" : ""}, {withSupplier.length} lines)
                  </Button>
                );
              })()}
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
                {needsPurchase.map((line, i) => {
                  const done = orderedLines.has(line.id);
                  const prevSection = i > 0 ? needsPurchase[i - 1].sectionLabel : null;
                  const firstSec = ticketLines[0]?.sectionLabel;
                  const showSection = line.sectionLabel && line.sectionLabel !== prevSection && line.sectionLabel !== firstSec;
                  return (
                    <React.Fragment key={line.id}>
                      {showSection && (
                        <TableRow className="bg-[#252525] border-t-2 border-[#555555]">
                          <TableCell colSpan={6} className="py-2 px-3">
                            <span className="text-[11px] uppercase tracking-widest font-bold text-[#FF9900]">
                              {line.sectionLabel}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      {/* BOM parent header for grouped components */}
                      {line.parentLineId && line.parentDescription && (i === 0 || needsPurchase[i - 1]?.parentLineId !== line.parentLineId) && (
                        <TableRow className="bg-[#3399FF]/5 border-t border-[#3399FF]/20">
                          <TableCell colSpan={6} className="py-1.5 px-3">
                            <span className="text-[10px] uppercase tracking-widest font-bold text-[#3399FF]">
                              BOM: {line.parentDescription}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow className={`${selectedForPurchase.has(line.id) ? "bg-[#3399FF]/5" : ""} ${line.parentLineId ? "bg-[#3399FF]/3" : ""}`}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedForPurchase.has(line.id)}
                            onChange={() => togglePurchaseSelect(line.id)}
                            className="accent-[#3399FF]"
                          />
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {line.parentLineId && <span className="text-[#3399FF] mr-1">{"\u2514"}</span>}
                          {line.description}
                          {stockQtyUsed(line) > 0 && (
                            <span className="text-[10px] text-[#FF6600] ml-2">
                              ({stockQtyUsed(line)} from stock)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {stockQtyUsed(line) > 0 ? (
                            <span>
                              <span className="text-[#FF9900]">{remainingQty(line)}</span>
                              <span className="text-[10px] text-[#888888]">/{dec(line.qty)}</span>
                            </span>
                          ) : dec(line.qty)}
                        </TableCell>
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
                                  setStockPickerQty(String(remainingQty(line) || Number(line.qty?.toString() || 1)));
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
                  <Button
                    size="sm"
                    className="ml-auto h-6 text-[10px] bg-[#FF6600] text-black hover:bg-[#CC5500]"
                    onClick={async () => {
                      const expressInput = prompt("Express delivery charge (£) — leave blank for none:");
                      const expressCharge = Number(expressInput) || 0;
                      // Find or create a ProcurementOrder for this supplier
                      const sup = suppliers.find(s => s.name === supplier);
                      if (!sup) { alert("Supplier not in suppliers list"); return; }
                      // Find ANY existing PO for this supplier on this ticket — don't create duplicates
                      const existing = procurementOrders.find(po => po.supplier?.id === sup.id);
                      let poId = existing?.id;
                      if (!poId) {
                        // Create a new PO
                        const poNo = `PO-${Date.now()}-${supplier.substring(0, 4).toUpperCase().replace(/\s/g, "")}`;
                        const res = await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            ticketId,
                            supplierId: sup.id,
                            poNo,
                            lines: lines.map(l => ({
                              ticketLineId: l.id,
                              description: l.description,
                              qty: Number(l.qty?.toString() || 1),
                              unitCost: Number(l.expectedCostUnit?.toString() || 0),
                              lineTotal: Number(l.qty?.toString() || 1) * Number(l.expectedCostUnit?.toString() || 0),
                            })),
                          }),
                        });
                        if (!res.ok) { alert("Failed to create PO"); return; }
                        const created = await res.json();
                        poId = created.id;
                      }
                      // Generate PDF
                      const pdfRes = await fetch(`/api/procurement-orders/${poId}/generate-pdf`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ expressCharge }),
                      });
                      if (pdfRes.ok) {
                        window.open(`/api/procurement-orders/${poId}/generate-pdf`, "_blank");
                        router.refresh();
                      } else {
                        alert("Failed to generate PDF");
                      }
                    }}
                  >
                    <FileText className="size-3 mr-1" />
                    Generate PO PDF
                  </Button>
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

      {/* From Stock Items — with full allocation details */}
      {(() => {
        const fromStock = ticketLines.filter(
          (l) => l.status === "FROM_STOCK" && !poLineIds.has(l.id)
        );
        // Also include lines with partial stock allocation (still in purchase list but have usages)
        const partialStock = ticketLines.filter(
          (l) => l.status !== "FROM_STOCK" && (l.stockUsages?.length || 0) > 0
        );
        const allStockLines = [...fromStock, ...partialStock];
        if (allStockLines.length === 0) return null;

        const totalStockCost = allStockLines.reduce((sum, l) => {
          return sum + (l.stockUsages || []).reduce((s, su) => s + Number(su.totalCost?.toString() || 0), 0);
        }, 0);

        return (
          <div className="space-y-3">
            <h3 className="text-[11px] uppercase tracking-widest text-[#FF6600] font-bold">
              From Stock — {allStockLines.length} items &middot; £{dec(totalStockCost)} allocated
            </h3>
            <div className="border border-[#FF6600]/20 bg-[#FF6600]/5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line Item</TableHead>
                    <TableHead className="text-right">Qty Used</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Cost/Unit</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="w-16 print-hidden"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allStockLines.map((line) => {
                    const usages = line.stockUsages || [];
                    if (usages.length === 0) {
                      // Line marked FROM_STOCK but no usage records yet
                      return (
                        <TableRow key={line.id}>
                          <TableCell className="text-sm font-medium">{line.description}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{dec(line.qty)}</TableCell>
                          <TableCell className="text-xs text-[#888888]">{line.unit}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{dec(line.expectedCostUnit)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">—</TableCell>
                          <TableCell>
                            <Badge className="text-[9px] bg-[#FF6600]/15 text-[#FF6600]">Stock</Badge>
                          </TableCell>
                          <TableCell className="print-hidden">
                            <Button size="sm" variant="outline" className="h-6 text-[10px] text-[#FF9900] hover:text-[#FF6600] border-[#333333]" onClick={() => handleUndoOrdered(line.id)}>
                              Undo
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    }
                    // One row per stock usage with full details
                    return usages.map((su, idx) => {
                      const si = su.stockItem;
                      const sourceLabel = si?.sourceType === "RETURN" ? "Return" : si?.sourceType === "MOQ_EXCESS" ? "MOQ Excess" : si?.sourceType || "Stock";
                      return (
                        <TableRow key={su.id} className={idx > 0 ? "border-t border-[#333333]/30" : ""}>
                          {idx === 0 && (
                            <TableCell className="text-sm font-medium" rowSpan={usages.length}>
                              {line.description}
                              {line.status !== "FROM_STOCK" && (
                                <div className="text-[10px] text-[#FF9900] mt-0.5">Partial — {remainingQty(line)} still to order</div>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right tabular-nums text-sm">{dec(su.qtyUsed)}</TableCell>
                          <TableCell className="text-xs text-[#888888]">{line.unit}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{dec(su.costPerUnit)}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-medium">{dec(su.totalCost)}</TableCell>
                          <TableCell>
                            <div>
                              <Badge className={`text-[9px] ${si?.sourceType === "RETURN" ? "bg-[#3399FF]/15 text-[#3399FF]" : "bg-[#FF9900]/15 text-[#FF9900]"}`}>
                                {sourceLabel}
                              </Badge>
                              {si?.supplierName && (
                                <div className="text-[10px] text-[#888888] mt-0.5">{si.supplierName}</div>
                              )}
                              {si?.originBillNo && (
                                <div className="text-[10px] text-[#666666]">{si.originBillNo}</div>
                              )}
                              {si?.originTicketTitle && (
                                <div className="text-[10px] text-[#555555]">From: {si.originTicketTitle}</div>
                              )}
                            </div>
                          </TableCell>
                          {idx === 0 && (
                            <TableCell className="print-hidden" rowSpan={usages.length}>
                              {line.status === "FROM_STOCK" && (
                                <Button size="sm" variant="outline" className="h-6 text-[10px] text-[#FF9900] hover:text-[#FF6600] border-[#333333]" onClick={() => handleUndoOrdered(line.id)}>
                                  Undo
                                </Button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    });
                  })}
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
                  {stockQtyUsed(line) > 0 && (
                    <p className="text-xs text-[#FF6600] mt-1">
                      {stockQtyUsed(line)} already from stock &middot; {remainingQty(line)} remaining
                    </p>
                  )}
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
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/tickets/${ticketId}/call-offs`)}
            >
              <Package className="size-4 mr-1" /> Call-off tracker
            </Button>
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
                        <SelectItem key={s.id} value={s.id} label={s.name}>
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
                            <SelectItem key={tl.id} value={tl.id} label={tl.description}>
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
                if (editLineItems.length === 0) {
                  setEditLineItems(po.lines.map(l => ({
                    id: l.id,
                    description: l.description,
                    qty: String(l.qty || 0),
                    unitCost: String(l.unitCost || 0),
                    lineTotal: String(l.lineTotal || 0),
                  })));
                }
                const updateLineItem = (idx: number, field: string, value: string) => {
                  setEditLineItems((prev) => {
                    const next = [...prev];
                    next[idx] = { ...next[idx], [field]: value };
                    if (field === "qty" || field === "unitCost") {
                      const q = Number(next[idx].qty) || 0;
                      const u = Number(next[idx].unitCost) || 0;
                      next[idx].lineTotal = (q * u).toFixed(2);
                    }
                    return next;
                  });
                };
                const handleSaveLines = async () => {
                  setEditPOSubmitting(true);
                  try {
                    await Promise.all(editLineItems.map(line =>
                      fetch(`/api/procurement-order-lines/${line.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          unitCost: Number(line.unitCost) || 0,
                          lineTotal: Number(line.lineTotal) || 0,
                          supplierCode: line.supplierCode || undefined,
                        }),
                      })
                    ));
                    setEditPOId(null);
                    setEditLineItems([]);
                    router.refresh();
                  } finally {
                    setEditPOSubmitting(false);
                  }
                };
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
                    <div className="border-t border-[#333333] pt-4 mt-4">
                      <Label className="text-[11px] uppercase tracking-widest text-[#FF6600]">Line Items</Label>
                      <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                        {editLineItems.map((line, idx) => (
                          <div key={line.id} className="border border-[#333333] bg-[#111111] p-2 space-y-1.5">
                            <div className="text-xs font-medium text-[#CCCCCC]">{line.description}</div>
                            <div className="grid grid-cols-3 gap-2 text-xs">
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Qty</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={line.qty}
                                  onChange={(e) => updateLineItem(idx, "qty", e.target.value)}
                                  className="h-7 text-xs"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Unit Cost</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={line.unitCost}
                                  onChange={(e) => updateLineItem(idx, "unitCost", e.target.value)}
                                  className="h-7 text-xs"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <Label className="text-[10px]">Line Total</Label>
                                <Input
                                  type="text"
                                  value={line.lineTotal}
                                  disabled
                                  className="h-7 text-xs bg-[#222222]"
                                />
                              </div>
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-[10px]">Supplier Code (Optional)</Label>
                              <Input
                                type="text"
                                placeholder="e.g. SKU-123"
                                value={line.supplierCode || ""}
                                onChange={(e) => updateLineItem(idx, "supplierCode", e.target.value)}
                                className="h-7 text-xs"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <SheetFooter className="flex gap-2">
                      <Button type="button" variant="outline" onClick={() => { setEditPOId(null); setEditLineItems([]); }} disabled={editPOSubmitting}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={handleSaveLines} disabled={editPOSubmitting} className="bg-[#00CC66] text-black hover:bg-[#00AA55]">
                        {editPOSubmitting ? "Saving..." : "Save Lines"}
                      </Button>
                      <Button type="submit" disabled={editPOSubmitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                        {editPOSubmitting ? "Saving..." : "Save PO Details"}
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

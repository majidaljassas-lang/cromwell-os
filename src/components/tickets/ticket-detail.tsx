"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ArrowLeft,
  SeparatorHorizontal,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { QuotePanel } from "@/components/quotes/quote-panel";
import { TicketProcurementTab } from "@/components/procurement/ticket-procurement-tab";
import { RfqExploder } from "@/components/tickets/rfq-exploder";
import { EvidencePanel } from "@/components/evidence/evidence-panel";

// ─── Constants ──────────────────────────────────────────────────────────────

const LINE_TYPES = [
  "MATERIAL",
  "LABOUR",
  "PLANT",
  "SERVICE",
  "DELIVERY",
  "CASH_SALE",
  "RETURN_ADJUSTMENT",
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Evaluate simple math expressions: 500/2, 500*0.8, 100+50, 200-30
 * Returns the number result, or NaN if invalid.
 */
function evalMathExpr(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return NaN;
  // Check if it's a simple math expression (numbers with +, -, *, /)
  if (/^[\d.]+\s*[+\-*/]\s*[\d.]+$/.test(trimmed)) {
    const parts = trimmed.match(/^([\d.]+)\s*([+\-*/])\s*([\d.]+)$/);
    if (parts) {
      const a = parseFloat(parts[1]);
      const op = parts[2];
      const b = parseFloat(parts[3]);
      switch (op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return b !== 0 ? a / b : NaN;
      }
    }
  }
  // Otherwise treat as a plain number
  return parseFloat(trimmed);
}

const INPUT_CLS =
  "h-7 text-xs px-1.5 bg-transparent border border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] outline-none text-[#E0E0E0]";
const NUM_CLS = `${INPUT_CLS} w-20 text-right tabular-nums`;

// ─── Types ──────────────────────────────────────────────────────────────────

type TicketLine = {
  id: string;
  lineType: string;
  description: string;
  internalNotes: string | null;
  qty: Decimal;
  unit: string;
  payingCustomerId: string;
  expectedCostUnit: Decimal;
  expectedCostTotal: Decimal;
  actualCostTotal: Decimal;
  suggestedSaleUnit: Decimal;
  actualSaleUnit: Decimal;
  actualSaleTotal: Decimal;
  expectedMarginTotal: Decimal;
  actualMarginTotal: Decimal;
  varianceTotal: Decimal;
  supplierId: string | null;
  supplierName: string | null;
  supplierReference: string | null;
  sectionLabel: string | null;
  status: string;
  createdAt: Date;
  payingCustomer: { id: string; name: string };
};

type EvidenceFragment = {
  id: string;
  sourceType: string;
  fragmentType: string;
  fragmentText: string | null;
  timestamp: Date;
  isPrimaryEvidence: boolean;
};

type EventItem = {
  id: string;
  eventType: string;
  timestamp: Date;
  sourceRef: string | null;
  notes: string | null;
};

type TaskItem = {
  id: string;
  taskType: string;
  priority: string;
  status: string;
  generatedReason: string | null;
  dueAt: Date | null;
  assignedTo: string | null;
};

type QuoteLineData = {
  id: string;
  description: string;
  qty: Decimal;
  unitPrice: Decimal;
  lineTotal: Decimal;
};

type QuoteData = {
  id: string;
  quoteNo: string;
  versionNo: number;
  quoteType: string;
  status: string;
  totalSell: Decimal;
  issuedAt: string | null;
  notes: string | null;
  customer: { id: string; name: string };
  lines: QuoteLineData[];
};

type EvidencePackItemData = {
  id: string;
  evidenceFragmentId: string | null;
  eventId: string | null;
  documentRef: string | null;
  summaryText: string | null;
  sortOrder: number;
  evidenceFragment: {
    id: string;
    fragmentType: string;
    fragmentText: string | null;
  } | null;
  event: {
    id: string;
    eventType: string;
    notes: string | null;
  } | null;
};

type EvidencePackData = {
  id: string;
  packType: string;
  status: string;
  generatedAt: string | null;
  finalizedAt: string | null;
  createdAt: string;
  items: EvidencePackItemData[];
};

type CustomerOption = { id: string; name: string };
type SupplierOption = { id: string; name: string };
type SiteOption = { id: string; siteName: string };
type CommercialLinkOption = {
  id: string;
  siteId: string;
  customerId: string;
  role: string;
  site: { id: string; siteName: string };
  customer: { id: string; name: string };
};

type TicketData = {
  id: string;
  title: string;
  description: string | null;
  ticketMode: string;
  status: string;
  revenueState: string;
  poRequired: boolean;
  poStatus: string | null;
  createdAt: Date;
  closedAt: Date | null;
  payingCustomer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  siteCommercialLink: { id: string } | null;
  lines: TicketLine[];
  evidenceFragments: EvidenceFragment[];
  events: EventItem[];
  tasks: TaskItem[];
};

// ─── InlineLineRow ──────────────────────────────────────────────────────────

function InlineLineRow({
  line,
  selected,
  onToggleSelect,
  onSaved,
  onDelete,
  supplierLookup,
}: {
  line: TicketLine;
  selected: boolean;
  onToggleSelect: () => void;
  onSaved: () => void;
  onDelete: () => void;
  supplierLookup: Record<string, string>;
}) {
  const [desc, setDesc] = useState("");
  const [supplierVal, setSupplierVal] = useState("");
  const [qtyVal, setQtyVal] = useState("");
  const [costVal, setCostVal] = useState("");
  const [saleVal, setSaleVal] = useState("");
  const [marginPctVal, setMarginPctVal] = useState("");
  const [mounted, setMounted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDesc(line.description);
    setSupplierVal(line.supplierName || supplierLookup[line.id] || "");
    setQtyVal(line.qty ? String(Number(line.qty)) : "1");
    setCostVal(
      Number(line.expectedCostUnit || 0)
        ? String(Number(line.expectedCostUnit))
        : ""
    );
    setSaleVal(
      Number(line.actualSaleUnit || 0)
        ? String(Number(line.actualSaleUnit))
        : ""
    );
    setMarginPctVal("");
    setMounted(true);
  }, [
    line.id,
    line.description,
    line.qty,
    line.expectedCostUnit,
    line.actualSaleUnit,
    line.supplierName,
    supplierLookup,
  ]);
  const [saving, setSaving] = useState(false);

  const qty = Number(qtyVal || 1);
  const costUnit = evalMathExpr(costVal || "0");
  const saleUnit = evalMathExpr(saleVal || "0");
  const costTotal = (isNaN(costUnit) ? 0 : costUnit) * qty;
  const saleTotal = (isNaN(saleUnit) ? 0 : saleUnit) * qty;
  const margin = saleTotal - costTotal;
  const marginPct = saleTotal > 0 ? (margin / saleTotal) * 100 : 0;

  const sc =
    line.status === "READY_FOR_QUOTE"
      ? "text-[#00CC66] bg-[#00CC66]/10"
      : line.status === "PRICED"
      ? "text-[#FF9900] bg-[#FF9900]/10"
      : "text-[#888888] bg-[#333333]";

  async function saveField(field: string, value: unknown) {
    setSaving(true);
    await fetch(`/api/ticket-lines/${line.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value || undefined }),
    });
    setSaving(false);
    // Silent save — do NOT call onSaved/router.refresh
  }

  async function saveMultipleFields(fields: Record<string, unknown>) {
    setSaving(true);
    await fetch(`/api/ticket-lines/${line.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    setSaving(false);
  }

  function onBlurDesc() {
    if (desc !== line.description) saveField("description", desc);
  }

  function onBlurSupplier() {
    if (supplierVal !== (line.supplierName || "")) {
      saveField("supplierName", supplierVal || null);
    }
  }

  function onBlurQty() {
    const v = Number(qtyVal);
    if (v !== Number(line.qty)) saveField("qty", v);
  }

  function onBlurCost() {
    const v = evalMathExpr(costVal || "0");
    if (!isNaN(v)) {
      setCostVal(v ? String(v) : "");
      if (v !== Number(line.expectedCostUnit || 0))
        saveField("expectedCostUnit", v || undefined);
    }
  }

  function onBlurSale() {
    const v = evalMathExpr(saleVal || "0");
    if (!isNaN(v)) {
      setSaleVal(v ? String(v) : "");
      if (v !== Number(line.actualSaleUnit || 0))
        saveField("actualSaleUnit", v || undefined);
    }
  }

  function onBlurMarginPct() {
    const pct = Number(marginPctVal);
    if (!marginPctVal.trim() || isNaN(pct)) {
      setMarginPctVal("");
      return;
    }
    // margin% = (sale - cost) / sale * 100
    // => sale = cost / (1 - pct/100)
    const currentCost = evalMathExpr(costVal || "0");
    if (!isNaN(currentCost) && currentCost > 0 && pct < 100) {
      const newSale = currentCost / (1 - pct / 100);
      const rounded = Math.round(newSale * 100) / 100;
      setSaleVal(String(rounded));
      setMarginPctVal("");
      saveField("actualSaleUnit", rounded);
    } else {
      setMarginPctVal("");
    }
  }

  function kd(e: React.KeyboardEvent) {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${line.description}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ticket-lines/${line.id}`, {
        method: "DELETE",
      });
      if (res.ok) onDelete();
    } finally {
      setDeleting(false);
    }
  }

  if (!mounted) {
    return (
      <TableRow className="hover:bg-[#1E1E1E]">
        <TableCell className="p-1 w-8">
          <input type="checkbox" disabled className="accent-[#FF6600]" />
        </TableCell>
        <TableCell className="p-1 max-w-[250px] font-medium text-xs">
          {line.description}
        </TableCell>
        <TableCell className="text-[10px] text-[#888888] p-1">
          {line.supplierName || "—"}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">
          {dec(line.qty)}
        </TableCell>
        <TableCell className="text-[10px] text-[#888888] p-1">
          {line.unit}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">
          {dec(line.expectedCostUnit)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">
          {dec(line.actualSaleUnit)}
        </TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">
          —
        </TableCell>
        <TableCell className="text-right text-[10px] p-1">—</TableCell>
        <TableCell className="p-1">
          <Badge className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 text-[#888888] bg-[#333333]">
            {line.status.replace(/_/g, " ")}
          </Badge>
        </TableCell>
        <TableCell className="p-1 w-8" />
      </TableRow>
    );
  }

  return (
    <TableRow
      key={`${line.id}-${line.actualSaleUnit}-${line.expectedCostUnit}`}
      className={`hover:bg-[#1E1E1E] ${saving ? "opacity-60" : ""} ${selected ? "bg-[#FF6600]/5" : ""}`}
    >
      <TableCell className="p-1 w-8">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="accent-[#FF6600]"
        />
      </TableCell>
      <TableCell className="p-0 max-w-[250px]">
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={onBlurDesc}
          onKeyDown={kd}
          className={`${INPUT_CLS} w-full font-medium`}
        />
      </TableCell>
      <TableCell className="p-0 max-w-[100px]">
        <input
          value={supplierVal}
          onChange={(e) => setSupplierVal(e.target.value)}
          onBlur={onBlurSupplier}
          onKeyDown={kd}
          className={`${INPUT_CLS} w-full text-[10px] text-[#888888]`}
          placeholder="\u2014"
        />
      </TableCell>
      <TableCell className="p-0">
        <input
          type="number"
          step="0.01"
          value={qtyVal}
          onChange={(e) => setQtyVal(e.target.value)}
          onBlur={onBlurQty}
          onKeyDown={kd}
          className={`${NUM_CLS} w-16`}
        />
      </TableCell>
      <TableCell className="text-[#888888] text-[10px] p-1">
        {line.unit}
      </TableCell>
      <TableCell className="p-0">
        <input
          value={costVal}
          onChange={(e) => setCostVal(e.target.value)}
          onBlur={onBlurCost}
          onKeyDown={kd}
          className={NUM_CLS}
          placeholder="0.00"
        />
      </TableCell>
      <TableCell className="p-0">
        <input
          value={saleVal}
          onChange={(e) => setSaleVal(e.target.value)}
          onBlur={onBlurSale}
          onKeyDown={kd}
          className={NUM_CLS}
          placeholder="0.00"
        />
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs">
        <span className={margin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>
          {fmtMoney(margin)}
        </span>
      </TableCell>
      <TableCell className="p-0">
        <input
          value={marginPctVal}
          onChange={(e) => setMarginPctVal(e.target.value)}
          onBlur={onBlurMarginPct}
          onKeyDown={kd}
          className={`${NUM_CLS} w-16`}
          placeholder={`${marginPct.toFixed(1)}%`}
        />
      </TableCell>
      <TableCell>
        <Badge
          className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${sc}`}
        >
          {line.status.replace(/_/g, " ")}
        </Badge>
      </TableCell>
      <TableCell className="p-1 w-8">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1 hover:bg-[#FF3333]/10 text-[#666666] hover:text-[#FF3333] transition-colors"
          title="Delete line"
        >
          <Trash2 className="size-3" />
        </button>
      </TableCell>
    </TableRow>
  );
}

// ─── Status helpers ─────────────────────────────────────────────────────────

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "CAPTURED":
      return "outline";
    case "PRICING":
    case "QUOTED":
      return "secondary";
    case "APPROVED":
    case "ORDERED":
    case "DELIVERED":
      return "default";
    case "RECOVERY":
    case "PENDING_PO":
      return "destructive";
    case "INVOICED":
    case "CLOSED":
      return "secondary";
    default:
      return "outline";
  }
}

const STATUS_ORDER = [
  "CAPTURED",
  "PRICING",
  "QUOTED",
  "APPROVED",
  "ORDERED",
  "DELIVERED",
  "COSTED",
  "PENDING_PO",
  "RECOVERY",
  "VERIFIED",
  "LOCKED",
  "INVOICED",
  "CLOSED",
];

function priorityVariant(
  priority: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (priority) {
    case "HIGH":
    case "URGENT":
      return "destructive";
    case "MEDIUM":
      return "secondary";
    default:
      return "outline";
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TicketDetail({
  ticket,
  quotes = [],
  customers = [],
  procurementOrders = [],
  costAllocations = [],
  absorbedCostAllocations = [],
  suppliers = [],
  customerPOs = [],
  evidencePacks = [],
  salesInvoices = [],
  sites = [],
  commercialLinks = [],
}: {
  ticket: TicketData;
  quotes?: QuoteData[];
  customers?: CustomerOption[];
  procurementOrders?: any[];
  costAllocations?: any[];
  absorbedCostAllocations?: any[];
  suppliers?: SupplierOption[];
  customerPOs?: any[];
  evidencePacks?: EvidencePackData[];
  salesInvoices?: any[];
  sites?: SiteOption[];
  commercialLinks?: CommercialLinkOption[];
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<{
    totals: {
      totalSale: number;
      totalCost: number;
      totalMargin: number;
      totalMarginPct: number;
    };
  } | null>(null);

  // Fetch commercial summary from backend (single source of truth)
  const refreshSummary = useCallback(() => {
    fetch(`/api/tickets/${ticket.id}/commercial-summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSummary(d))
      .catch(() => {});
  }, [ticket.id]);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  // Filter lines: only show ACTIVE statuses (exclude RAW and MERGED)
  const activeLines = ticket.lines.filter(
    (l) => l.status !== "RAW" && l.status !== "MERGED"
  );

  // ── Line selection for Convert to Invoice ──
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(
    new Set()
  );
  const allSelected =
    activeLines.length > 0 && selectedLineIds.size === activeLines.length;
  function toggleSelectAll() {
    if (allSelected) {
      setSelectedLineIds(new Set());
    } else {
      setSelectedLineIds(new Set(activeLines.map((l) => l.id)));
    }
  }
  function toggleSelectLine(lineId: string) {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  // ── Supplier lookup from procurement orders (memoized) ──
  const supplierLookup = useMemo(() => {
    const map: Record<string, string> = {};
    if (procurementOrders) {
      for (const po of procurementOrders) {
        if (po.supplier?.name && po.lines) {
          for (const pl of po.lines) {
            if (pl.ticketLineId) {
              map[pl.ticketLineId] = po.supplier.name;
            }
          }
        }
      }
    }
    return map;
  }, [procurementOrders]);

  // ── Line management state ──
  const [lineSheetOpen, setLineSheetOpen] = useState(false);
  const [submittingLine, setSubmittingLine] = useState(false);
  const [lineType, setLineType] = useState<string>("MATERIAL");
  const [lineUnit, setLineUnit] = useState<string>("EA");
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [sectionLabel, setSectionLabel] = useState("EXTRA ORDER");
  const [sectionSource, setSectionSource] = useState("CALL");
  const [sectionMaterials, setSectionMaterials] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [editingEvent, setEditingEvent] = useState<{
    id: string;
    notes: string;
    sourceRef: string;
  } | null>(null);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [editEventNotes, setEditEventNotes] = useState("");
  const [editEventSourceRef, setEditEventSourceRef] = useState("");

  // ── RFQ Extract collapsible state ──
  const [rfqOpen, setRfqOpen] = useState(false);

  // ── Quote button state ──
  const [creatingQuote, setCreatingQuote] = useState(false);

  // Quote readiness: all lines READY_FOR_QUOTE, at least 1 line
  const isQuoteReady =
    ticket.lines.length > 0 &&
    ticket.lines.every(
      (l) =>
        l.status === "READY_FOR_QUOTE" ||
        l.status === "ORDERED" ||
        l.status === "FULLY_COSTED" ||
        l.status === "INVOICED"
    );

  async function handleCreateQuote() {
    setCreatingQuote(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteType: "STANDARD",
          customerId: ticket.payingCustomer.id,
          siteId: ticket.site?.id,
          siteCommercialLinkId: ticket.siteCommercialLink?.id,
        }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setCreatingQuote(false);
    }
  }

  // ── Convert to Invoice ──
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  async function handleConvertToInvoice() {
    if (selectedLineIds.size === 0) return;
    setCreatingInvoice(true);
    try {
      const res = await fetch(
        `/api/tickets/${ticket.id}/generate-invoice-draft`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerId: ticket.payingCustomer.id,
            lineIds: [...selectedLineIds],
          }),
        }
      );
      if (res.ok) {
        router.push("/invoices");
      }
    } finally {
      setCreatingInvoice(false);
    }
  }

  // ── Add Line ──
  async function handleAddLine(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmittingLine(true);

    const form = e.currentTarget;
    const formData = new FormData(form);

    const body: Record<string, unknown> = {
      lineType,
      description: formData.get("description") as string,
      qty: Number(formData.get("qty")) || 1,
      unit: lineUnit,
      payingCustomerId: ticket.payingCustomer.id,
      internalNotes: (formData.get("internalNotes") as string) || undefined,
      expectedCostUnit:
        Number(formData.get("expectedCostUnit")) || undefined,
      suggestedSaleUnit:
        Number(formData.get("suggestedSaleUnit")) || undefined,
      actualSaleUnit: Number(formData.get("actualSaleUnit")) || undefined,
    };

    try {
      const res = await fetch(`/api/tickets/${ticket.id}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        form.reset();
        setLineSheetOpen(false);
        setLineType("MATERIAL");
        setLineUnit("EA");
        router.refresh();
      }
    } finally {
      setSubmittingLine(false);
    }
  }

  // ── Add Section ──
  async function handleAddSection() {
    if (!sectionLabel.trim()) return;
    setAddingSection(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: sectionLabel.trim(),
          source: sectionSource,
          materials: sectionMaterials.trim(),
          payingCustomerId: ticket.payingCustomer.id,
        }),
      });
      if (res.ok) {
        setSectionDialogOpen(false);
        setSectionLabel("EXTRA ORDER");
        setSectionMaterials("");
        router.refresh();
      }
    } finally {
      setAddingSection(false);
    }
  }

  // ── Delete section ──
  async function handleDeleteSection(sectionLabelToDelete: string) {
    if (
      !confirm(
        `Delete section "${sectionLabelToDelete}" and all its lines? This cannot be undone.`
      )
    )
      return;
    // Delete all lines in this section
    const sectionLines = activeLines.filter(
      (l) => l.sectionLabel === sectionLabelToDelete
    );
    for (const line of sectionLines) {
      await fetch(`/api/ticket-lines/${line.id}`, { method: "DELETE" });
    }
    router.refresh();
  }

  // ── Event management ──
  function openEditEvent(ev: {
    id: string;
    notes: string | null;
    sourceRef: string | null;
  }) {
    setEditingEvent({
      id: ev.id,
      notes: ev.notes || "",
      sourceRef: ev.sourceRef || "",
    });
    setEditEventNotes(ev.notes || "");
    setEditEventSourceRef(ev.sourceRef || "");
    setEditEventOpen(true);
  }

  async function handleSaveEvent() {
    if (!editingEvent) return;
    await fetch(`/api/events/${editingEvent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notes: editEventNotes,
        sourceRef: editEventSourceRef,
      }),
    });
    setEditEventOpen(false);
    setEditingEvent(null);
    router.refresh();
  }

  async function handleDeleteEvent(eventId: string) {
    if (!confirm("Delete this event?")) return;
    await fetch(`/api/events/${eventId}`, { method: "DELETE" });
    router.refresh();
  }

  // ── PO Sheet state ──
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poNo, setPoNo] = useState("");
  const [poDate, setPoDate] = useState("");
  const [poIssuer, setPoIssuer] = useState("");
  const [poSiteId, setPoSiteId] = useState(ticket.site?.id || "");
  const [poNotes, setPoNotes] = useState("");

  // Filter sites by customer commercial links
  const filteredSites = useMemo(() => {
    if (!commercialLinks || commercialLinks.length === 0) return sites || [];
    const customerLinkSiteIds = commercialLinks
      .filter((cl) => cl.customerId === ticket.payingCustomer.id)
      .map((cl) => cl.siteId);
    if (customerLinkSiteIds.length === 0) return sites || [];
    return (sites || []).filter((s) => customerLinkSiteIds.includes(s.id));
  }, [sites, commercialLinks, ticket.payingCustomer.id]);

  async function handleCreatePO() {
    if (!poNo.trim()) return;
    setPoSubmitting(true);
    try {
      const res = await fetch("/api/customer-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          customerId: ticket.payingCustomer.id,
          siteId: poSiteId || ticket.site?.id || undefined,
          siteCommercialLinkId: ticket.siteCommercialLink?.id || undefined,
          poNo: poNo.trim(),
          poType: "STANDARD_FIXED",
          poDate: poDate || undefined,
          status: "RECEIVED",
          notes: poNotes || undefined,
        }),
      });
      if (res.ok) {
        setPoSheetOpen(false);
        setPoNo("");
        setPoDate("");
        setPoIssuer("");
        setPoNotes("");
        router.refresh();
      }
    } finally {
      setPoSubmitting(false);
    }
  }

  // First PO linked to this ticket
  const linkedPO = customerPOs && customerPOs.length > 0 ? customerPOs[0] : null;

  // First invoice linked to this ticket
  const linkedInvoice =
    salesInvoices && salesInvoices.length > 0 ? salesInvoices[0] : null;

  const statusIndex = STATUS_ORDER.indexOf(ticket.status);
  const progressPercent =
    statusIndex >= 0
      ? Math.round(((statusIndex + 1) / STATUS_ORDER.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* ── HEADER ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/tickets">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="size-4 mr-1" />
                Back
              </Button>
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-[#E0E0E0]">
              {ticket.title}
            </h1>
          </div>
          <div className="flex items-center gap-2 ml-[72px] flex-wrap">
            <Badge variant="outline">
              {ticket.ticketMode.replace(/_/g, " ")}
            </Badge>
            <Badge variant={statusVariant(ticket.status)}>
              {ticket.status.replace(/_/g, " ")}
            </Badge>
            <span className="text-sm text-[#888888]">
              {ticket.payingCustomer.name}
            </span>
            {ticket.site && (
              <>
                <span className="text-[#888888]">/</span>
                <span className="text-sm text-[#888888]">
                  {ticket.site.siteName}
                </span>
              </>
            )}
            <span className="text-xs text-[#888888] ml-2">
              ID: {ticket.id.slice(0, 8)}
            </span>

            {/* PO Number */}
            <Separator orientation="vertical" className="h-4 mx-1" />
            {linkedPO ? (
              <Link
                href="/po-register"
                className="text-xs text-[#FF6600] hover:underline flex items-center gap-1"
              >
                <FileText className="size-3" />
                PO: {linkedPO.poNo}
              </Link>
            ) : (
              <Sheet open={poSheetOpen} onOpenChange={setPoSheetOpen}>
                <SheetTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2 bg-[#222222] text-[#888888] border-[#333333] hover:text-[#FF6600] hover:border-[#FF6600]"
                    >
                      <Plus className="size-3 mr-0.5" />
                      Add PO
                    </Button>
                  }
                />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Add Customer PO</SheetTitle>
                    <SheetDescription>
                      Enter the Purchase Order details received from the
                      customer.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-col gap-4 px-4">
                    <div className="space-y-1.5">
                      <Label>PO Number *</Label>
                      <Input
                        value={poNo}
                        onChange={(e) => setPoNo(e.target.value)}
                        placeholder="e.g. PO-12345"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>PO Date</Label>
                      <Input
                        type="date"
                        value={poDate}
                        onChange={(e) => setPoDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Issuer</Label>
                      <Input
                        value={poIssuer}
                        onChange={(e) => setPoIssuer(e.target.value)}
                        placeholder="Who issued the PO?"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Site</Label>
                      <Select
                        value={poSiteId}
                        onValueChange={(v) => setPoSiteId(v ?? "")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select site" />
                        </SelectTrigger>
                        <SelectContent>
                          {filteredSites.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.siteName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Textarea
                        value={poNotes}
                        onChange={(e) => setPoNotes(e.target.value)}
                        rows={3}
                        placeholder="Optional notes"
                      />
                    </div>
                    <SheetFooter>
                      <Button
                        onClick={handleCreatePO}
                        disabled={poSubmitting || !poNo.trim()}
                      >
                        {poSubmitting ? "Creating..." : "Create PO"}
                      </Button>
                    </SheetFooter>
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {/* Invoice Reference */}
            {linkedInvoice && (
              <>
                <Separator orientation="vertical" className="h-4 mx-1" />
                <Link
                  href="/invoices"
                  className="text-xs text-[#00CC66] hover:underline flex items-center gap-1"
                >
                  <FileText className="size-3" />
                  INV: {linkedInvoice.invoiceNo || "Draft"}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Status Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[#888888]">
          <span>Progress</span>
          <span>
            {ticket.status.replace(/_/g, " ")} ({progressPercent}%)
          </span>
        </div>
        <div className="h-2 w-full bg-[#333333]">
          <div
            className="h-full bg-[#FF6600] transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between">
          {STATUS_ORDER.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-1.5  ${
                i <= statusIndex ? "bg-primary" : "bg-[#333333]"
              }`}
              title={s.replace(/_/g, " ")}
            />
          ))}
        </div>
      </div>

      {/* Commercial Summary Cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">
              TOTAL SALE
            </div>
            <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">
              &pound;
              {summary.totals.totalSale.toLocaleString("en-GB", {
                minimumFractionDigits: 2,
              })}
            </div>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">
              TOTAL COST
            </div>
            <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">
              &pound;
              {summary.totals.totalCost.toLocaleString("en-GB", {
                minimumFractionDigits: 2,
              })}
            </div>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">
              MARGIN
            </div>
            <div
              className={`text-lg font-bold bb-mono mt-1 ${summary.totals.totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}
            >
              &pound;
              {summary.totals.totalMargin.toLocaleString("en-GB", {
                minimumFractionDigits: 2,
              })}
            </div>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">
              MARGIN %
            </div>
            <div
              className={`text-lg font-bold bb-mono mt-1 ${summary.totals.totalMarginPct >= 20 ? "text-[#00CC66]" : summary.totals.totalMarginPct >= 10 ? "text-[#FF9900]" : "text-[#FF3333]"}`}
            >
              {summary.totals.totalMarginPct.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      {ticket.description && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">{ticket.description}</p>
          </CardContent>
        </Card>
      )}

      {/* ── 6 TABS ─────────────────────────────────────────────────── */}
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">Lines ({activeLines.length})</TabsTrigger>
          <TabsTrigger value="evidence">
            Evidence ({ticket.evidenceFragments.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks ({ticket.tasks.length})
          </TabsTrigger>
          <TabsTrigger value="events">
            Events ({ticket.events.length})
          </TabsTrigger>
          <TabsTrigger value="quotes">
            Quotes ({quotes.length})
          </TabsTrigger>
          <TabsTrigger value="procurement">
            Procurement ({procurementOrders.length})
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: LINES ──────────────────────────────────────────── */}
        <TabsContent value="lines" className="mt-4 space-y-4">
          {/* RFQ Extract — collapsible at top */}
          <div className="border border-[#333333] bg-[#1A1A1A]">
            <button
              onClick={() => setRfqOpen(!rfqOpen)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#222222] transition-colors"
            >
              <div className="flex items-center gap-2">
                {rfqOpen ? (
                  <ChevronDown className="size-3 text-[#888888]" />
                ) : (
                  <ChevronRight className="size-3 text-[#888888]" />
                )}
                <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
                  RFQ EXTRACT
                </span>
              </div>
              <span className="text-[10px] text-[#666666]">
                Paste enquiry text and extract line items
              </span>
            </button>
            {rfqOpen && (
              <div className="border-t border-[#333333] p-3">
                <RfqExploder
                  ticketId={ticket.id}
                  payingCustomerId={ticket.payingCustomer.id}
                  sourceText={[
                    ticket.description,
                    ...ticket.events
                      .filter((ev) => ev.notes)
                      .map((ev) =>
                        (ev.notes || "").replace(/^Section added:\s*/i, "")
                      ),
                  ]
                    .filter(Boolean)
                    .join("\n\n")}
                />
              </div>
            )}
          </div>

          {/* Lines header with actions */}
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
              Ticket Lines
            </h2>
            <div className="flex gap-2">
              {/* Generate Quote button — always available when there are lines */}
              {ticket.lines.length > 0 &&
                ticket.status !== "INVOICED" &&
                ticket.status !== "CLOSED" && (
                  <Button
                    onClick={handleCreateQuote}
                    disabled={creatingQuote}
                    className="bg-[#FF6600] text-black hover:bg-[#FF9900] font-bold"
                    size="sm"
                  >
                    {creatingQuote ? "Creating..." : "Generate Quote"}
                  </Button>
                )}
              {!isQuoteReady &&
                ticket.lines.length > 0 &&
                ticket.status !== "QUOTED" &&
                ticket.status !== "ORDERED" && (
                  <div className="text-[10px] text-[#888888] bb-mono self-center">
                    {
                      ticket.lines.filter(
                        (l) => l.status === "READY_FOR_QUOTE"
                      ).length
                    }
                    /{ticket.lines.length} LINES READY
                  </div>
                )}

              {/* Convert to Invoice button */}
              {selectedLineIds.size > 0 && (
                <Button
                  onClick={handleConvertToInvoice}
                  disabled={creatingInvoice}
                  className="bg-[#00CC66] text-black hover:bg-[#00AA55] font-bold"
                  size="sm"
                >
                  {creatingInvoice
                    ? "Creating..."
                    : `Convert ${selectedLineIds.size} to Invoice`}
                </Button>
              )}

              {/* Add Section */}
              <Sheet
                open={sectionDialogOpen}
                onOpenChange={setSectionDialogOpen}
              >
                <SheetTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]"
                    >
                      <SeparatorHorizontal className="size-4 mr-1" />
                      Add Section
                    </Button>
                  }
                />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Add Section &amp; Lines</SheetTitle>
                    <SheetDescription>
                      Type the items from a call/email. Lines will be created
                      automatically with events logged.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-col gap-4 px-4">
                    <div className="space-y-1.5">
                      <Label>Source</Label>
                      <Select
                        value={sectionSource}
                        onValueChange={(v) => setSectionSource(v ?? "CALL")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CALL">Phone Call</SelectItem>
                          <SelectItem value="EMAIL">Email</SelectItem>
                          <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                          <SelectItem value="IN_PERSON">In Person</SelectItem>
                          <SelectItem value="OTHER">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Section Label</Label>
                      <Input
                        value={sectionLabel}
                        onChange={(e) => setSectionLabel(e.target.value)}
                        placeholder="e.g. EXTRA ORDER"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Materials / Items</Label>
                      <Textarea
                        value={sectionMaterials}
                        onChange={(e) => setSectionMaterials(e.target.value)}
                        rows={6}
                        placeholder={
                          "Type or paste the items, e.g.:\n35mm Compression Lever Ball Valve Red Handle - 2 no.\n22mm Compression Lever Ball Valve Blue - 1 no.\n15mm Copper Tube 3m - 10 lengths"
                        }
                      />
                      <p className="text-[10px] text-[#666666]">
                        One item per line. The system will auto-parse quantities
                        and descriptions.
                      </p>
                    </div>
                    <SheetFooter>
                      <Button
                        onClick={handleAddSection}
                        disabled={
                          addingSection ||
                          !sectionLabel.trim() ||
                          !sectionMaterials.trim()
                        }
                      >
                        {addingSection
                          ? "Processing..."
                          : "Add Section & Lines"}
                      </Button>
                    </SheetFooter>
                  </div>
                </SheetContent>
              </Sheet>

              {/* Add Line */}
              <Sheet open={lineSheetOpen} onOpenChange={setLineSheetOpen}>
                <SheetTrigger
                  render={
                    <Button size="sm">
                      <Plus className="size-4 mr-1" />
                      Add Line
                    </Button>
                  }
                />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Add Ticket Line</SheetTitle>
                    <SheetDescription>
                      Add a new line item to this ticket.
                    </SheetDescription>
                  </SheetHeader>
                  <form
                    onSubmit={handleAddLine}
                    className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
                  >
                    <div className="space-y-1.5">
                      <Label>Line Type</Label>
                      <Select
                        value={lineType}
                        onValueChange={(v) => setLineType(v ?? "MATERIAL")}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {LINE_TYPES.map((lt) => (
                            <SelectItem key={lt} value={lt}>
                              {lt.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="line-description">Description *</Label>
                      <Input
                        id="line-description"
                        name="description"
                        required
                        placeholder="e.g. 25mm rebar 6m lengths"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="qty">Qty</Label>
                        <Input
                          id="qty"
                          name="qty"
                          type="number"
                          step="0.01"
                          defaultValue="1"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Unit of Measure</Label>
                        <Select
                          value={lineUnit}
                          onValueChange={(v) => setLineUnit(v ?? "EA")}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select UOM" />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              [
                                "EA",
                                "M",
                                "LENGTH",
                                "PACK",
                                "LOT",
                                "SET",
                              ] as const
                            ).map((u) => (
                              <SelectItem key={u} value={u}>
                                {u}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="internalNotes">
                        Internal Breakdown / Notes
                      </Label>
                      <Textarea
                        id="internalNotes"
                        name="internalNotes"
                        rows={3}
                        placeholder={
                          "e.g.\n10x 15mm lengths\n10x 22mm lengths\n2x 28mm lengths"
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="expectedCostUnit">Cost / Unit</Label>
                        <Input
                          id="expectedCostUnit"
                          name="expectedCostUnit"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="suggestedSaleUnit">
                          Sugg. Sale / Unit
                        </Label>
                        <Input
                          id="suggestedSaleUnit"
                          name="suggestedSaleUnit"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="actualSaleUnit">
                          Actual Sale / Unit
                        </Label>
                        <Input
                          id="actualSaleUnit"
                          name="actualSaleUnit"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <SheetFooter>
                      <Button type="submit" disabled={submittingLine}>
                        {submittingLine ? "Adding..." : "Add Line"}
                      </Button>
                    </SheetFooter>
                  </form>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {/* Lines Table */}
          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 p-1">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="accent-[#FF6600]"
                    />
                  </TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Sale</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeLines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={11}
                      className="text-center py-8 text-[#888888]"
                    >
                      No lines yet. Add your first line item.
                    </TableCell>
                  </TableRow>
                ) : (
                  activeLines.map((line) => (
                    <React.Fragment key={line.id}>
                      {line.sectionLabel && (
                        <TableRow className="bg-[#252525] border-t-2 border-[#555555]">
                          <TableCell colSpan={10} className="py-2 px-3">
                            <span className="text-[11px] uppercase tracking-widest font-bold text-[#FF9900]">
                              {line.sectionLabel}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 px-1">
                            <button
                              onClick={() =>
                                handleDeleteSection(line.sectionLabel!)
                              }
                              className="p-1 hover:bg-[#FF3333]/10 text-[#666666] hover:text-[#FF3333] transition-colors"
                              title="Delete section"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </TableCell>
                        </TableRow>
                      )}
                      <InlineLineRow
                        key={`${line.id}-${line.actualSaleUnit}-${line.expectedCostUnit}`}
                        line={line}
                        selected={selectedLineIds.has(line.id)}
                        onToggleSelect={() => toggleSelectLine(line.id)}
                        onSaved={() => {
                          refreshSummary();
                        }}
                        onDelete={() => {
                          router.refresh();
                        }}
                        supplierLookup={supplierLookup}
                      />
                    </React.Fragment>
                  ))
                )}
                {/* TOTALS ROW */}
                {activeLines.length > 0 && (() => {
                  const totalCost = activeLines.reduce((s, l) => s + (Number(l.expectedCostUnit || 0) * Number(l.qty || 0)), 0);
                  const totalSale = activeLines.reduce((s, l) => s + (Number(l.actualSaleUnit || 0) * Number(l.qty || 0)), 0);
                  const totalMargin = totalSale - totalCost;
                  const totalMarginPct = totalSale > 0 ? (totalMargin / totalSale) * 100 : 0;
                  return (
                    <TableRow className="border-t-2 border-[#444444] bg-[#1A1A1A] font-bold">
                      <TableCell colSpan={2}></TableCell>
                      <TableCell colSpan={3} className="text-right text-[10px] text-[#888888] uppercase tracking-wider">TOTALS</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">£{totalCost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">£{totalSale.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className={`text-right tabular-nums text-xs ${totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>£{totalMargin.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className={`text-right tabular-nums text-[10px] ${totalMarginPct >= 20 ? "text-[#00CC66]" : totalMarginPct >= 10 ? "text-[#FF9900]" : "text-[#FF3333]"}`}>{totalMarginPct.toFixed(1)}%</TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── TAB 2: EVIDENCE ──────────────────────────────────────── */}
        <TabsContent value="evidence" className="mt-4">
          <EvidencePanel
            ticketId={ticket.id}
            evidenceFragments={ticket.evidenceFragments as any}
            evidencePacks={evidencePacks}
            ticketLines={ticket.lines.map((l) => ({
              id: l.id,
              description: l.description,
            }))}
          />
        </TabsContent>

        {/* ── TAB 3: TASKS ─────────────────────────────────────────── */}
        <TabsContent value="tasks" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">
            Tasks
          </h2>
          {ticket.tasks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#888888]">
                No tasks generated yet.
              </CardContent>
            </Card>
          ) : (
            <div className="border border-[#333333] bg-[#1A1A1A]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Assigned To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ticket.tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium">
                        {task.taskType.replace(/_/g, " ")}
                      </TableCell>
                      <TableCell>
                        <Badge variant={priorityVariant(task.priority)}>
                          {task.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{task.status}</Badge>
                      </TableCell>
                      <TableCell className="text-[#888888] max-w-[200px] truncate">
                        {task.generatedReason || "\u2014"}
                      </TableCell>
                      <TableCell className="text-[#888888] tabular-nums">
                        {task.dueAt
                          ? new Date(task.dueAt).toLocaleDateString()
                          : "\u2014"}
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {task.assignedTo || "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 4: EVENTS ────────────────────────────────────────── */}
        <TabsContent value="events" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">
            Events
          </h2>
          {ticket.events.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#888888]">
                No events recorded yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {ticket.events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-3 border-l-2 border-[#333333] pl-4 py-2 group"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {ev.eventType.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-xs text-[#888888]">
                        {new Date(ev.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {ev.notes && (
                      <p className="text-sm text-[#888888] mt-1">{ev.notes}</p>
                    )}
                    {ev.sourceRef && (
                      <p className="text-xs text-[#888888] mt-0.5">
                        Source: {ev.sourceRef}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      onClick={() => openEditEvent(ev)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-400"
                      onClick={() => handleDeleteEvent(ev.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Edit Event Sheet */}
              <Sheet
                open={editEventOpen}
                onOpenChange={(open) => {
                  setEditEventOpen(open);
                  if (!open) setEditingEvent(null);
                }}
              >
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Edit Event</SheetTitle>
                    <SheetDescription>
                      Update the event details.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-col gap-4 px-4">
                    <div className="space-y-1.5">
                      <Label>Source</Label>
                      <Input
                        value={editEventSourceRef}
                        onChange={(e) => setEditEventSourceRef(e.target.value)}
                        placeholder="e.g. CALL, EMAIL, WhatsApp"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Textarea
                        value={editEventNotes}
                        onChange={(e) => setEditEventNotes(e.target.value)}
                        rows={4}
                      />
                    </div>
                    <SheetFooter>
                      <Button onClick={handleSaveEvent}>Save</Button>
                    </SheetFooter>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          )}
        </TabsContent>

        {/* ── TAB 5: QUOTES ────────────────────────────────────────── */}
        <TabsContent value="quotes" className="mt-4">
          <QuotePanelWithPO
            ticketId={ticket.id}
            quotes={quotes}
            customers={customers}
            ticket={ticket}
            filteredSites={filteredSites}
          />
        </TabsContent>

        {/* ── TAB 6: PROCUREMENT ───────────────────────────────────── */}
        <TabsContent value="procurement" className="mt-4">
          <TicketProcurementTab
            ticketId={ticket.id}
            ticketTitle={ticket.title}
            ticketStatus={ticket.status}
            procurementOrders={procurementOrders}
            supplierBills={[]}
            costAllocations={costAllocations}
            absorbedCosts={absorbedCostAllocations}
            suppliers={suppliers}
            ticketLines={ticket.lines.map((l) => ({
              id: l.id,
              description: l.description,
              qty: l.qty,
              unit: l.unit,
              expectedCostUnit: l.expectedCostUnit,
              status: l.status,
              sectionLabel: l.sectionLabel,
              supplierName: l.supplierName,
            }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── QuotePanelWithPO ───────────────────────────────────────────────────────
// Wraps QuotePanel and adds "Enter PO" button on APPROVED quotes

function QuotePanelWithPO({
  ticketId,
  quotes,
  customers,
  ticket,
  filteredSites,
}: {
  ticketId: string;
  quotes: QuoteData[];
  customers: CustomerOption[];
  ticket: TicketData;
  filteredSites: SiteOption[];
}) {
  const router = useRouter();
  const [enterPOOpen, setEnterPOOpen] = useState(false);
  const [poQuoteId, setPOQuoteId] = useState<string | null>(null);
  const [poSubmitting, setPOSubmitting] = useState(false);
  const [poNo, setPONo] = useState("");
  const [poDate, setPODate] = useState("");
  const [poIssuer, setPOIssuer] = useState("");
  const [poSiteId, setPOSiteId] = useState(ticket.site?.id || "");
  const [poNotes, setPONotes] = useState("");

  function openEnterPO(quoteId: string) {
    setPOQuoteId(quoteId);
    setEnterPOOpen(true);
    setPONo("");
    setPODate("");
    setPOIssuer("");
    setPOSiteId(ticket.site?.id || "");
    setPONotes("");
  }

  async function handleCreatePO() {
    if (!poNo.trim()) return;
    setPOSubmitting(true);
    try {
      // Find the quote to get its value
      const quote = quotes.find((q) => q.id === poQuoteId);
      const totalValue = quote ? Number(quote.totalSell) : undefined;

      const res = await fetch("/api/customer-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          customerId: ticket.payingCustomer.id,
          siteId: poSiteId || ticket.site?.id || undefined,
          siteCommercialLinkId: ticket.siteCommercialLink?.id || undefined,
          poNo: poNo.trim(),
          poType: "STANDARD_FIXED",
          poDate: poDate || undefined,
          status: "RECEIVED",
          totalValue,
          notes: poNotes
            ? `Issuer: ${poIssuer}\n${poNotes}`
            : poIssuer
            ? `Issuer: ${poIssuer}`
            : undefined,
        }),
      });
      if (res.ok) {
        setEnterPOOpen(false);
        setPOQuoteId(null);
        router.refresh();
      }
    } finally {
      setPOSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <QuotePanel
        ticketId={ticketId}
        quotes={quotes}
        customers={customers}
      />

      {/* Enter PO buttons on APPROVED quotes */}
      {quotes
        .filter((q) => q.status === "APPROVED")
        .map((q) => (
          <div
            key={`po-btn-${q.id}`}
            className="flex items-center gap-2 border border-[#00CC66]/20 bg-[#00CC66]/5 px-3 py-2"
          >
            <Badge className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 text-[#00CC66] bg-[#00CC66]/10">
              APPROVED
            </Badge>
            <span className="text-xs text-[#E0E0E0] flex-1">
              {q.quoteNo} &mdash; {dec(q.totalSell)}
            </span>
            <Button
              size="sm"
              onClick={() => openEnterPO(q.id)}
              className="bg-[#FF6600] text-black hover:bg-[#FF9900] font-bold"
            >
              <FileText className="size-3 mr-1" />
              Enter PO
            </Button>
          </div>
        ))}

      {/* Enter PO Sheet */}
      <Sheet open={enterPOOpen} onOpenChange={setEnterPOOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Enter Customer PO</SheetTitle>
            <SheetDescription>
              Record the Purchase Order received from the customer for this
              approved quote.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <div className="space-y-1.5">
              <Label>PO Number *</Label>
              <Input
                value={poNo}
                onChange={(e) => setPONo(e.target.value)}
                placeholder="e.g. PO-12345"
              />
            </div>
            <div className="space-y-1.5">
              <Label>PO Date</Label>
              <Input
                type="date"
                value={poDate}
                onChange={(e) => setPODate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Issuer</Label>
              <Input
                value={poIssuer}
                onChange={(e) => setPOIssuer(e.target.value)}
                placeholder="Who issued the PO?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Site</Label>
              <Select
                value={poSiteId}
                onValueChange={(v) => setPOSiteId(v ?? "")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select site" />
                </SelectTrigger>
                <SelectContent>
                  {filteredSites.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.siteName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={poNotes}
                onChange={(e) => setPONotes(e.target.value)}
                rows={3}
                placeholder="Optional notes"
              />
            </div>
            <SheetFooter>
              <Button
                onClick={handleCreatePO}
                disabled={poSubmitting || !poNo.trim()}
              >
                {poSubmitting ? "Creating..." : "Create PO"}
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

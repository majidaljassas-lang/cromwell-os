"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowLeft, SeparatorHorizontal, Pencil, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { SalesBundlesPanel } from "@/components/sales-bundles/sales-bundles-panel";
import { QuotePanel } from "@/components/quotes/quote-panel";
import { TicketProcurementTab } from "@/components/procurement/ticket-procurement-tab";
import { RfqExploder } from "@/components/tickets/rfq-exploder";
import { TicketPOTab } from "@/components/po-register/ticket-po-tab";
import { EvidencePanel } from "@/components/evidence/evidence-panel";
import { CompetitiveBidPanel } from "@/components/tickets/competitive-bid-panel";

const LINE_TYPES = [
  "MATERIAL",
  "LABOUR",
  "PLANT",
  "SERVICE",
  "DELIVERY",
  "CASH_SALE",
  "RETURN_ADJUSTMENT",
] as const;

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const INPUT_CLS = "h-7 text-xs px-1.5 bg-transparent border border-transparent hover:border-[#444] focus:border-[#FF6600] focus:bg-[#222222] outline-none text-[#E0E0E0]";
const NUM_CLS = `${INPUT_CLS} w-20 text-right tabular-nums`;

function InlineLineRow({ line, onClickRow, onSaved }: {
  line: TicketLine;
  onClickRow: () => void;
  onSaved: () => void;
}) {
  const [desc, setDesc] = useState("");
  const [qtyVal, setQtyVal] = useState("");
  const [costVal, setCostVal] = useState("");
  const [saleVal, setSaleVal] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDesc(line.description);
    setQtyVal(line.qty ? String(Number(line.qty)) : "1");
    setCostVal(Number(line.expectedCostUnit || 0) ? String(Number(line.expectedCostUnit)) : "");
    setSaleVal(Number(line.actualSaleUnit || 0) ? String(Number(line.actualSaleUnit)) : "");
    setMounted(true);
  }, [line.description, line.qty, line.expectedCostUnit, line.actualSaleUnit]);
  const [saving, setSaving] = useState(false);

  const qty = Number(qtyVal || 1);
  const costUnit = Number(costVal || 0);
  const saleUnit = Number(saleVal || 0);
  const costTotal = costUnit * qty;
  const saleTotal = saleUnit * qty;
  const margin = saleTotal - costTotal;
  const marginPct = saleTotal > 0 ? (margin / saleTotal) * 100 : 0;

  const sc = line.status === "READY_FOR_QUOTE"
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
    onSaved();
  }

  function onBlurDesc() { if (desc !== line.description) saveField("description", desc); }
  function onBlurQty() { const v = Number(qtyVal); if (v !== Number(line.qty)) saveField("qty", v); }
  function onBlurCost() { const v = Number(costVal || 0); if (v !== Number(line.expectedCostUnit || 0)) saveField("expectedCostUnit", v || undefined); }
  function onBlurSale() { const v = Number(saleVal || 0); if (v !== Number(line.actualSaleUnit || 0)) saveField("actualSaleUnit", v || undefined); }

  function kd(e: React.KeyboardEvent) { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }

  if (!mounted) {
    // SSR placeholder — static text only, no inputs
    return (
      <TableRow className="hover:bg-[#1E1E1E]">
        <TableCell className="p-1 max-w-[250px] font-medium text-xs">{line.description}</TableCell>
        <TableCell className="text-[10px] text-[#888888] p-1">{line.supplierName || "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">{dec(line.qty)}</TableCell>
        <TableCell className="text-[10px] text-[#888888] p-1">{line.unit}</TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">{dec(line.expectedCostUnit)}</TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">{dec(line.actualSaleUnit)}</TableCell>
        <TableCell className="text-right tabular-nums text-xs p-1">—</TableCell>
        <TableCell className="text-right text-[10px] p-1">—</TableCell>
        <TableCell className="p-1"><Badge className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 text-[#888888] bg-[#333333]">{line.status.replace(/_/g, " ")}</Badge></TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className={`hover:bg-[#1E1E1E] ${saving ? "opacity-60" : ""}`}>
      <TableCell className="p-0 max-w-[250px]">
        <input value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={onBlurDesc} onKeyDown={kd}
          className={`${INPUT_CLS} w-full font-medium`} />
      </TableCell>
      <TableCell className="text-[10px] text-[#888888] max-w-[100px] truncate cursor-pointer p-1" onClick={onClickRow}>
        {line.supplierName || "—"}
      </TableCell>
      <TableCell className="p-0">
        <input type="number" step="0.01" value={qtyVal} onChange={(e) => setQtyVal(e.target.value)} onBlur={onBlurQty} onKeyDown={kd}
          className={`${NUM_CLS} w-16`} />
      </TableCell>
      <TableCell className="text-[#888888] text-[10px] cursor-pointer p-1" onClick={onClickRow}>
        {line.unit}
      </TableCell>
      <TableCell className="p-0">
        <input type="number" step="0.01" value={costVal} onChange={(e) => setCostVal(e.target.value)} onBlur={onBlurCost} onKeyDown={kd}
          className={NUM_CLS} placeholder="0.00" />
      </TableCell>
      <TableCell className="p-0">
        <input type="number" step="0.01" value={saleVal} onChange={(e) => setSaleVal(e.target.value)} onBlur={onBlurSale} onKeyDown={kd}
          className={NUM_CLS} placeholder="0.00" />
      </TableCell>
      <TableCell className="text-right tabular-nums text-xs">
        <span className={margin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>
          {fmtMoney(margin)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums text-[10px]">
        <span className={marginPct >= 20 ? "text-[#00CC66]" : marginPct >= 10 ? "text-[#FF9900]" : "text-[#FF3333]"}>
          {marginPct.toFixed(1)}%
        </span>
      </TableCell>
      <TableCell>
        <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${sc}`}>
          {line.status.replace(/_/g, " ")}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

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

type RecoveryCaseItem = {
  id: string;
  reasonType: string;
  recoveryStatus: string;
  stuckValue: Decimal;
  nextAction: string | null;
  currentStageStartedAt: Date | null;
};

type DealSheetItem = {
  id: string;
  versionNo: number;
  mode: string;
  status: string;
  totalExpectedCost: Decimal;
  totalExpectedSell: Decimal;
  totalExpectedMargin: Decimal;
  totalActualCost: Decimal;
  totalActualSell: Decimal;
  totalActualMargin: Decimal;
};

type SalesBundleCostLink = {
  id: string;
  ticketLineId: string;
  linkedCostValue: Decimal;
  linkedQty: Decimal;
  contributionType: string;
  ticketLine: { id: string; description: string };
};

type SalesBundleData = {
  id: string;
  name: string;
  description: string | null;
  bundleType: string;
  pricingMode: string;
  targetSellTotal: Decimal;
  actualSellTotal: Decimal;
  status: string;
  costLinks: SalesBundleCostLink[];
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

type SalesInvoiceLineData = {
  id: string;
  description: string;
  qty: Decimal;
  unitPrice: Decimal;
  lineTotal: Decimal;
  poMatched: boolean;
  poMatchStatus: string | null;
};

type SalesInvoiceData = {
  id: string;
  invoiceNo: string | null;
  poNo: string | null;
  invoiceType: string;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  totalSell: Decimal;
  customer: { id: string; name: string };
  lines: SalesInvoiceLineData[];
  poAllocations: { id: string; allocatedValue: Decimal; status: string }[];
};

type CustomerOption = { id: string; name: string };
type SupplierOption = { id: string; name: string };
type SiteOption = { id: string; siteName: string };
type CommercialLinkOption = { id: string; siteId: string; customerId: string; site: SiteOption };

type TicketData = {
  id: string;
  title: string;
  description: string | null;
  ticketMode: string;
  status: string;
  revenueState: string;
  createdAt: Date;
  closedAt: Date | null;
  payingCustomer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  siteCommercialLink: { id: string } | null;
  lines: TicketLine[];
  evidenceFragments: EvidenceFragment[];
  events: EventItem[];
  tasks: TaskItem[];
  recoveryCases: RecoveryCaseItem[];
  dealSheets: DealSheetItem[];
};

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

export function TicketDetail({
  ticket,
  salesBundles = [],
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
  salesBundles?: SalesBundleData[];
  quotes?: QuoteData[];
  customers?: CustomerOption[];
  procurementOrders?: any[];
  costAllocations?: any[];
  absorbedCostAllocations?: any[];
  suppliers?: SupplierOption[];
  customerPOs?: any[];
  evidencePacks?: EvidencePackData[];
  salesInvoices?: SalesInvoiceData[];
  sites?: SiteOption[];
  commercialLinks?: CommercialLinkOption[];
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<{
    totals: { totalSale: number; totalCost: number; totalMargin: number; totalMarginPct: number };
  } | null>(null);

  // Fetch commercial summary from backend (single source of truth)
  useEffect(() => {
    fetch(`/api/tickets/${ticket.id}/commercial-summary`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setSummary(d))
      .catch(() => {});
  }, [ticket.id]);

  // Filter lines: only show ACTIVE statuses (exclude RAW and MERGED)
  const activeLines = ticket.lines.filter(
    (l) => l.status !== "RAW" && l.status !== "MERGED"
  );

  const [lineSheetOpen, setLineSheetOpen] = useState(false);
  const [submittingLine, setSubmittingLine] = useState(false);
  const [lineType, setLineType] = useState<string>("MATERIAL");
  const [lineUnit, setLineUnit] = useState<string>("EA");
  const [editingLine, setEditingLine] = useState<TicketLine | null>(null);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [sectionLabel, setSectionLabel] = useState("EXTRA ORDER");
  const [sectionSource, setSectionSource] = useState("CALL");
  const [sectionMaterials, setSectionMaterials] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [editingEvent, setEditingEvent] = useState<{ id: string; notes: string; sourceRef: string } | null>(null);
  const [editEventOpen, setEditEventOpen] = useState(false);
  const [editEventNotes, setEditEventNotes] = useState("");
  const [editEventSourceRef, setEditEventSourceRef] = useState("");
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingLine, setDeletingLine] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // PO entry state (ticket header)
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [submittingPO, setSubmittingPO] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().split("T")[0]);
  const [poIssuer, setPoIssuer] = useState("");
  const [poSiteId, setPoSiteId] = useState("");
  const [poNotes, setPoNotes] = useState("");

  // Build supplier lookup from procurement orders for lines
  const supplierByLineId = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const po of procurementOrders) {
      const supplierName = po.supplier?.name;
      if (!supplierName) continue;
      for (const pol of po.lines || []) {
        if (pol.ticketLineId) {
          map[pol.ticketLineId] = supplierName;
        }
      }
    }
    return map;
  }, [procurementOrders]);

  async function handleDeleteLine() {
    if (!editingLine) return;
    if (!confirm(`Delete "${editingLine.description}"? This cannot be undone.`)) return;
    setDeletingLine(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/ticket-lines/${editingLine.id}`, { method: "DELETE" });
      if (res.ok) {
        setEditSheetOpen(false);
        setEditingLine(null);
        router.refresh();
      } else {
        const data = await res.json();
        setDeleteError(data.error || "Failed to delete");
      }
    } finally {
      setDeletingLine(false);
    }
  }
  const [creatingQuote, setCreatingQuote] = useState(false);

  // Quote readiness: all lines READY_FOR_QUOTE, at least 1 line
  const isQuoteReady = ticket.lines.length > 0 && ticket.lines.every(
    (l) => l.status === "READY_FOR_QUOTE" || l.status === "ORDERED" || l.status === "FULLY_COSTED" || l.status === "INVOICED"
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
        const data = await res.json();
        router.push(`/quotes/${data.id}`);
      }
    } finally {
      setCreatingQuote(false);
    }
  }

  const [creatingPOs, setCreatingPOs] = useState(false);

  // Check if quote is accepted (procurement can proceed)
  const hasAcceptedQuote = (quotes || []).some((q: { status: string }) => q.status === "APPROVED");
  const hasSuppliers = ticket.lines.some((l) => l.supplierId);
  const canCreatePurchasePlan = hasAcceptedQuote && hasSuppliers && ticket.status !== "ORDERED" && ticket.status !== "CLOSED";

  async function handleCreatePurchasePlan() {
    setCreatingPOs(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/create-purchase-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setCreatingPOs(false);
    }
  }

  async function handleSaveLineEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editingLine) return;
    setSavingEdit(true);

    const form = e.currentTarget;
    const fd = new FormData(form);

    const body: Record<string, unknown> = {};
    const desc = fd.get("edit-description") as string;
    if (desc && desc !== editingLine.description) body.description = desc;
    const notes = fd.get("edit-internalNotes") as string;
    if (notes !== (editingLine.internalNotes || "")) body.internalNotes = notes || null;
    const qty = Number(fd.get("edit-qty"));
    if (qty && qty !== Number(editingLine.qty)) body.qty = qty;
    const unit = fd.get("edit-unit") as string;
    if (unit && unit !== editingLine.unit) body.unit = unit;
    const expCost = fd.get("edit-expectedCostUnit") as string;
    if (expCost !== "") body.expectedCostUnit = Number(expCost);
    const actCost = fd.get("edit-actualCostTotal") as string;
    if (actCost !== "") body.actualCostTotal = Number(actCost);
    const suggSale = fd.get("edit-suggestedSaleUnit") as string;
    if (suggSale !== "") body.suggestedSaleUnit = Number(suggSale);
    const actSale = fd.get("edit-actualSaleUnit") as string;
    if (actSale !== "") body.actualSaleUnit = Number(actSale);
    const suppId = fd.get("edit-supplierId") as string;
    body.supplierId = suppId || null;
    if (suppId) {
      const sup = suppliers.find((s) => s.id === suppId);
      body.supplierName = sup?.name || null;
    } else {
      body.supplierName = null;
    }
    const supRef = fd.get("edit-supplierReference") as string;
    body.supplierReference = supRef || null;

    try {
      const res = await fetch(`/api/ticket-lines/${editingLine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditSheetOpen(false);
        setEditingLine(null);
        router.refresh();
      }
    } finally {
      setSavingEdit(false);
    }
  }

  const statusIndex = STATUS_ORDER.indexOf(ticket.status);
  const progressPercent =
    statusIndex >= 0
      ? Math.round(((statusIndex + 1) / STATUS_ORDER.length) * 100)
      : 0;

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
      expectedCostUnit: Number(formData.get("expectedCostUnit")) || undefined,
      suggestedSaleUnit: Number(formData.get("suggestedSaleUnit")) || undefined,
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

  function openEditEvent(ev: { id: string; notes: string | null; sourceRef: string | null }) {
    setEditingEvent({ id: ev.id, notes: ev.notes || "", sourceRef: ev.sourceRef || "" });
    setEditEventNotes(ev.notes || "");
    setEditEventSourceRef(ev.sourceRef || "");
    setEditEventOpen(true);
  }

  async function handleSaveEvent() {
    if (!editingEvent) return;
    await fetch(`/api/events/${editingEvent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: editEventNotes, sourceRef: editEventSourceRef }),
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

  // Find existing PO for this ticket
  const existingPO = customerPOs.length > 0 ? customerPOs[0] : null;

  // Filter sites for PO entry
  const customerLinks = commercialLinks.filter(cl => cl.customerId === ticket.payingCustomer.id);
  const filteredSites = customerLinks.length > 0
    ? customerLinks.map(cl => cl.site)
    : sites;

  async function handleSubmitPO() {
    if (!poNumber.trim()) return;
    setSubmittingPO(true);
    try {
      const noteParts: string[] = [];
      if (poIssuer.trim()) noteParts.push(`Issued by: ${poIssuer.trim()}`);
      if (poNotes.trim()) noteParts.push(poNotes.trim());

      const body: Record<string, unknown> = {
        ticketId: ticket.id,
        customerId: ticket.payingCustomer.id,
        poNo: poNumber.trim(),
        poType: "STANDARD_FIXED",
        poDate: poDate || undefined,
        status: "RECEIVED",
        notes: noteParts.length > 0 ? noteParts.join("\n") : undefined,
      };
      if (poSiteId) {
        body.siteId = poSiteId;
        const cl = customerLinks.find(l => l.siteId === poSiteId);
        if (cl) body.siteCommercialLinkId = cl.id;
      }

      const res = await fetch("/api/customer-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setPoSheetOpen(false);
        setPoNumber("");
        setPoDate(new Date().toISOString().split("T")[0]);
        setPoIssuer("");
        setPoSiteId("");
        setPoNotes("");
        router.refresh();
      }
    } finally {
      setSubmittingPO(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
          <div className="flex items-center gap-2 ml-[72px]">
            <Badge variant="outline">
              {ticket.ticketMode.replace(/_/g, " ")}
            </Badge>
            <Badge variant={statusVariant(ticket.status)}>
              {ticket.status.replace(/_/g, " ")}
            </Badge>
            {ticket.revenueState && ticket.revenueState !== "OPERATIONAL" && (
              <Badge className={ticket.revenueState === "RECOVERY_PIPELINE" ? "text-[9px] bg-[#FF9900]/15 text-[#FF9900] border border-[#FF9900]/30" : "text-[9px] bg-[#00CC66]/15 text-[#00CC66] border border-[#00CC66]/30"}>
                {ticket.revenueState === "RECOVERY_PIPELINE" ? "RECOVERY PIPELINE" : "REALISED"}
              </Badge>
            )}
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
            <span className="text-[#888888]">|</span>
            {existingPO ? (
              <Link href={`/po-register`}>
                <Badge variant="secondary" className="cursor-pointer hover:bg-[#333333]">
                  <FileText className="size-3 mr-1" />
                  PO: {existingPO.poNo}
                </Badge>
              </Link>
            ) : (
              <Sheet open={poSheetOpen} onOpenChange={setPoSheetOpen}>
                <SheetTrigger
                  render={
                    <Button size="sm" variant="outline" className="h-6 text-[10px] px-2 bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]">
                      <Plus className="size-3 mr-1" />
                      Add PO
                    </Button>
                  }
                />
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Add Purchase Order</SheetTitle>
                    <SheetDescription>
                      Enter the customer PO details for this ticket.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-col gap-4 px-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="po-number">PO Number *</Label>
                      <Input
                        id="po-number"
                        value={poNumber}
                        onChange={(e) => setPoNumber(e.target.value)}
                        placeholder="e.g. PO-12345"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="po-date">PO Date</Label>
                      <Input
                        id="po-date"
                        type="date"
                        value={poDate}
                        onChange={(e) => setPoDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="po-issuer">PO Issuer</Label>
                      <Input
                        id="po-issuer"
                        value={poIssuer}
                        onChange={(e) => setPoIssuer(e.target.value)}
                        placeholder="Who issued this PO?"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Site</Label>
                      {customerLinks.length === 0 && sites.length > 0 && (
                        <p className="text-[10px] text-[#FF9900]">No sites linked to this customer. Showing all sites.</p>
                      )}
                      <Select value={poSiteId} onValueChange={(v) => setPoSiteId(v ?? "")}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select site (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">-- None --</SelectItem>
                          {filteredSites.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.siteName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="po-notes">Notes</Label>
                      <Textarea
                        id="po-notes"
                        value={poNotes}
                        onChange={(e) => setPoNotes(e.target.value)}
                        rows={3}
                        placeholder="Optional notes"
                      />
                    </div>
                    <SheetFooter>
                      <Button
                        onClick={handleSubmitPO}
                        disabled={submittingPO || !poNumber.trim()}
                      >
                        {submittingPO ? "Creating..." : "Create PO"}
                      </Button>
                    </SheetFooter>
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isQuoteReady && ticket.status !== "QUOTED" && ticket.status !== "INVOICED" && ticket.status !== "CLOSED" && (
            <Button
              onClick={handleCreateQuote}
              disabled={creatingQuote}
              className="bg-[#FF6600] text-black hover:bg-[#FF9900] font-bold"
            >
              {creatingQuote ? "Creating..." : "Create Quote"}
            </Button>
          )}
          {!isQuoteReady && ticket.lines.length > 0 && ticket.status !== "QUOTED" && ticket.status !== "ORDERED" && (
            <div className="text-[10px] text-[#888888] bb-mono">
              {ticket.lines.filter((l) => l.status === "READY_FOR_QUOTE").length}/{ticket.lines.length} LINES READY
            </div>
          )}
          {canCreatePurchasePlan && (
            <Button
              onClick={handleCreatePurchasePlan}
              disabled={creatingPOs}
              className="bg-[#00CC66] text-black hover:bg-[#00AA55] font-bold"
            >
              {creatingPOs ? "Creating POs..." : "Create Purchase Plan"}
            </Button>
          )}
          {ticket.status === "ORDERED" && (
            <Badge className="text-[9px] uppercase tracking-wider font-bold px-2 py-1 text-[#00CC66] bg-[#00CC66]/10">
              POs CREATED
            </Badge>
          )}
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

      {/* Commercial Summary Cards — PRIMARY DECISION LAYER */}
      {summary && (
        <div className="grid grid-cols-4 gap-3">
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">TOTAL SALE</div>
            <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">£{summary.totals.totalSale.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">TOTAL COST</div>
            <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">£{summary.totals.totalCost.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">MARGIN</div>
            <div className={`text-lg font-bold bb-mono mt-1 ${summary.totals.totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
              £{summary.totals.totalMargin.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-3">
            <div className="text-[9px] uppercase tracking-widest text-[#888888]">MARGIN %</div>
            <div className={`text-lg font-bold bb-mono mt-1 ${summary.totals.totalMarginPct >= 20 ? "text-[#00CC66]" : summary.totals.totalMarginPct >= 10 ? "text-[#FF9900]" : "text-[#FF3333]"}`}>
              {summary.totals.totalMarginPct.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      {ticket.description && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">
              {ticket.description}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs defaultValue="lines">
        <TabsList>
          <TabsTrigger value="lines">
            Lines ({activeLines.length})
          </TabsTrigger>
          <TabsTrigger value="rfq">RFQ Extract</TabsTrigger>
          <TabsTrigger value="evidence">
            Evidence ({ticket.evidenceFragments.length})
          </TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks ({ticket.tasks.length})
          </TabsTrigger>
          <TabsTrigger value="events">
            Events ({ticket.events.length})
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="deal-sheet">Deal Sheet</TabsTrigger>
          <TabsTrigger value="bundles">
            Bundles ({salesBundles.length})
          </TabsTrigger>
          <TabsTrigger value="quotes">
            Quotes ({quotes.length})
          </TabsTrigger>
          <TabsTrigger value="procurement">
            Procurement ({procurementOrders.length})
          </TabsTrigger>
          <TabsTrigger value="po-register">
            PO Register ({customerPOs?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Invoices ({salesInvoices.length})
          </TabsTrigger>
          <TabsTrigger value="recovery">
            Recovery ({ticket.recoveryCases.length})
          </TabsTrigger>
        </TabsList>

        {/* ── LINES TAB ────────────────────────────────────────────── */}
        <TabsContent value="lines" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Ticket Lines</h2>
            <div className="flex gap-2">
            <Sheet open={sectionDialogOpen} onOpenChange={setSectionDialogOpen}>
              <SheetTrigger
                render={
                  <Button size="sm" variant="outline" className="bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]">
                    <SeparatorHorizontal className="size-4 mr-1" />
                    Add Section
                  </Button>
                }
              />
              <SheetContent side="right">
                <SheetHeader>
                  <SheetTitle>Add Section & Lines</SheetTitle>
                  <SheetDescription>
                    Type the items from a call/email. Lines will be created automatically with events logged.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-4 px-4">
                  <div className="space-y-1.5">
                    <Label>Source</Label>
                    <Select value={sectionSource} onValueChange={setSectionSource}>
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
                      placeholder={"Type or paste the items, e.g.:\n35mm Compression Lever Ball Valve Red Handle - 2 no.\n22mm Compression Lever Ball Valve Blue - 1 no.\n15mm Copper Tube 3m - 10 lengths"}
                    />
                    <p className="text-[10px] text-[#666666]">
                      One item per line. The system will auto-parse quantities and descriptions.
                    </p>
                  </div>
                  <SheetFooter>
                    <Button onClick={handleAddSection} disabled={addingSection || !sectionLabel.trim() || !sectionMaterials.trim()}>
                      {addingSection ? "Processing..." : "Add Section & Lines"}
                    </Button>
                  </SheetFooter>
                </div>
              </SheetContent>
            </Sheet>
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
                    <Select value={lineType} onValueChange={(v) => setLineType(v ?? "MATERIAL")}>
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
                      <Select value={lineUnit} onValueChange={(v) => setLineUnit(v ?? "EA")}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select UOM" />
                        </SelectTrigger>
                        <SelectContent>
                          {(["EA", "M", "LENGTH", "PACK", "LOT", "SET"] as const).map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="internalNotes">Internal Breakdown / Notes</Label>
                    <Textarea
                      id="internalNotes"
                      name="internalNotes"
                      rows={3}
                      placeholder={"e.g.\n10x 15mm lengths\n10x 22mm lengths\n2x 28mm lengths"}
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
                      <Label htmlFor="suggestedSaleUnit">Sugg. Sale / Unit</Label>
                      <Input
                        id="suggestedSaleUnit"
                        name="suggestedSaleUnit"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="actualSaleUnit">Actual Sale / Unit</Label>
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

          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Sale</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Margin %</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeLines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center py-8 text-[#888888]"
                    >
                      No lines yet. Add your first line item.
                    </TableCell>
                  </TableRow>
                ) : (
                  activeLines.map((line) => {
                    // Enrich supplier from procurement orders if not already set
                    const enrichedLine = line.supplierName
                      ? line
                      : { ...line, supplierName: supplierByLineId[line.id] || line.supplierName };
                    return (
                    <React.Fragment key={line.id}>
                      {line.sectionLabel && (
                        <TableRow className="bg-[#252525] border-t-2 border-[#555555]">
                          <TableCell colSpan={9} className="py-2 px-3">
                            <span className="text-[11px] uppercase tracking-widest font-bold text-[#FF9900]">
                              {line.sectionLabel}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      <InlineLineRow
                        key={`${line.id}-${line.actualSaleUnit}-${line.expectedCostUnit}`}
                        line={enrichedLine}
                        onClickRow={() => { setEditingLine(line); setEditSheetOpen(true); }}
                        onSaved={() => { router.refresh(); fetch(`/api/tickets/${ticket.id}/commercial-summary`).then(r => r.ok ? r.json() : null).then(d => setSummary(d)); }}
                      />
                    </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Edit Line Drawer */}
          <Sheet open={editSheetOpen} onOpenChange={(open) => { setEditSheetOpen(open); if (!open) setEditingLine(null); }}>
            <SheetContent side="right" className="bg-[#1A1A1A] border-[#333333] w-[420px] sm:max-w-[420px]">
              <SheetHeader>
                <SheetTitle className="text-[#E0E0E0]">Edit Line</SheetTitle>
                <SheetDescription className="text-[#666666]">
                  {editingLine?.description}
                </SheetDescription>
              </SheetHeader>
              {editingLine && (
                <form onSubmit={handleSaveLineEdit} className="flex flex-col gap-3 px-4 flex-1 overflow-y-auto">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-description">Description</Label>
                    <Input id="edit-description" name="edit-description" defaultValue={editingLine.description} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-internalNotes">Internal Notes / Breakdown</Label>
                    <Textarea id="edit-internalNotes" name="edit-internalNotes" rows={4} defaultValue={editingLine.internalNotes || ""} placeholder={"e.g.\n10x 15mm lengths\n10x 22mm lengths"} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-qty">Qty</Label>
                      <Input id="edit-qty" name="edit-qty" type="number" step="0.01" defaultValue={Number(editingLine.qty)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Unit of Measure</Label>
                      <select name="edit-unit" defaultValue={editingLine.unit} className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                        {["EA", "M", "LENGTH", "PACK", "LOT", "SET"].map((u) => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="border-t border-[#333333] pt-3 mt-1">
                    <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold mb-2">SUPPLIER (INTERNAL)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Supplier</Label>
                        <select name="edit-supplierId" defaultValue={editingLine.supplierId || ""} className="w-full h-9 bg-[#222222] border border-[#333333] text-[#E0E0E0] text-sm px-3">
                          <option value="">— None —</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-supplierReference">Supplier Ref</Label>
                        <Input id="edit-supplierReference" name="edit-supplierReference" defaultValue={editingLine.supplierReference || ""} placeholder="PO / ref number" />
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-[#333333] pt-3 mt-1">
                    <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold mb-2">PRICING (EX VAT)</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-expectedCostUnit">Expected Cost / Unit</Label>
                        <Input id="edit-expectedCostUnit" name="edit-expectedCostUnit" type="number" step="0.01" defaultValue={Number(editingLine.expectedCostUnit) || ""} placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-actualCostTotal">Actual Cost Total</Label>
                        <Input id="edit-actualCostTotal" name="edit-actualCostTotal" type="number" step="0.01" defaultValue={Number(editingLine.actualCostTotal) || ""} placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-suggestedSaleUnit">Suggested Sale / Unit</Label>
                        <Input id="edit-suggestedSaleUnit" name="edit-suggestedSaleUnit" type="number" step="0.01" defaultValue={Number(editingLine.suggestedSaleUnit) || ""} placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-actualSaleUnit">Actual Sale / Unit</Label>
                        <Input id="edit-actualSaleUnit" name="edit-actualSaleUnit" type="number" step="0.01" defaultValue={Number(editingLine.actualSaleUnit) || ""} placeholder="0.00" />
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-[#333333] pt-3 mt-1">
                    <div className="text-[10px] uppercase tracking-widest text-[#888888] font-bold mb-1">CURRENT STATUS</div>
                    <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${
                      editingLine.status === "READY_FOR_QUOTE" ? "text-[#00CC66] bg-[#00CC66]/10" :
                      editingLine.status === "PRICED" ? "text-[#FF9900] bg-[#FF9900]/10" :
                      "text-[#888888] bg-[#333333]"
                    }`}>{editingLine.status.replace(/_/g, " ")}</Badge>
                    <p className="text-[10px] text-[#666666] mt-1">Status auto-updates on save based on pricing completeness.</p>
                  </div>
                  {deleteError && (
                    <div className="text-[#FF3333] text-xs border border-[#FF3333]/30 bg-[#FF3333]/10 px-3 py-2">{deleteError}</div>
                  )}
                  <SheetFooter className="mt-2 flex justify-between">
                    <Button type="button" onClick={handleDeleteLine} disabled={deletingLine} variant="outline" className="bg-[#222222] text-[#FF3333] border-[#FF3333]/30 hover:bg-[#FF3333]/10">
                      {deletingLine ? "Deleting..." : "Delete Line"}
                    </Button>
                    <Button type="submit" disabled={savingEdit} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                      {savingEdit ? "Saving..." : "Save Changes"}
                    </Button>
                  </SheetFooter>
                </form>
              )}
            </SheetContent>
          </Sheet>
        </TabsContent>

        {/* ── RFQ EXTRACTION TAB ────────────────────────────────────── */}
        <TabsContent value="rfq" className="mt-4">
          <RfqExploder
            ticketId={ticket.id}
            payingCustomerId={ticket.payingCustomer.id}
            sourceText={[
              ticket.description,
              ...ticket.events
                .filter((ev) => ev.notes)
                .map((ev) => (ev.notes || "").replace(/^Section added:\s*/i, "")),
            ].filter(Boolean).join("\n\n")}
          />
        </TabsContent>

        {/* ── EVIDENCE TAB ─────────────────────────────────────────── */}
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

        {/* ── TASKS TAB ────────────────────────────────────────────── */}
        <TabsContent value="tasks" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">Tasks</h2>
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

        {/* ── EVENTS TAB ───────────────────────────────────────────── */}
        <TabsContent value="events" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">Events</h2>
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
                      <p className="text-sm text-[#888888] mt-1">
                        {ev.notes}
                      </p>
                    )}
                    {ev.sourceRef && (
                      <p className="text-xs text-[#888888] mt-0.5">
                        Source: {ev.sourceRef}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => openEditEvent(ev)}>
                      <Pencil className="size-3" />
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 w-7 p-0 text-red-500 hover:text-red-400" onClick={() => handleDeleteEvent(ev.id)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Edit Event Sheet */}
              <Sheet open={editEventOpen} onOpenChange={(open) => { setEditEventOpen(open); if (!open) setEditingEvent(null); }}>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Edit Event</SheetTitle>
                    <SheetDescription>Update the event details.</SheetDescription>
                  </SheetHeader>
                  <div className="flex flex-col gap-4 px-4">
                    <div className="space-y-1.5">
                      <Label>Source</Label>
                      <Input value={editEventSourceRef} onChange={(e) => setEditEventSourceRef(e.target.value)} placeholder="e.g. CALL, EMAIL, WhatsApp" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Textarea value={editEventNotes} onChange={(e) => setEditEventNotes(e.target.value)} rows={4} />
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

        {/* ── TIMELINE TAB ─────────────────────────────────────────── */}
        <TabsContent value="timeline" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">Timeline</h2>
          {(() => {
            const items = [
              ...ticket.events.map((ev) => ({
                id: ev.id,
                type: "event" as const,
                label: ev.eventType.replace(/_/g, " "),
                notes: ev.notes,
                timestamp: new Date(ev.timestamp),
              })),
              ...ticket.evidenceFragments.map((ef) => ({
                id: ef.id,
                type: "evidence" as const,
                label: ef.fragmentType.replace(/_/g, " "),
                notes: ef.fragmentText,
                timestamp: new Date(ef.timestamp),
              })),
              ...ticket.tasks.map((t) => ({
                id: t.id,
                type: "task" as const,
                label: `${t.taskType.replace(/_/g, " ")} [${t.status}]`,
                notes: t.generatedReason,
                timestamp: new Date(t.dueAt || t.id), // fallback
              })),
            ].sort(
              (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
            );

            if (items.length === 0) {
              return (
                <Card>
                  <CardContent className="py-8 text-center text-[#888888]">
                    No timeline entries yet.
                  </CardContent>
                </Card>
              );
            }

            return (
              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={`${item.type}-${item.id}`}
                    className="flex items-start gap-3 border-l-2 border-[#333333] pl-4 py-2"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            item.type === "event"
                              ? "outline"
                              : item.type === "evidence"
                              ? "secondary"
                              : "default"
                          }
                        >
                          {item.type}
                        </Badge>
                        <span className="text-sm font-medium">
                          {item.label}
                        </span>
                        <span className="text-xs text-[#888888]">
                          {item.timestamp.toLocaleString()}
                        </span>
                      </div>
                      {item.notes && (
                        <p className="text-sm text-[#888888] mt-1">
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </TabsContent>

        {/* ── DEAL SHEET TAB ──────────────────────────────────────── */}
        <TabsContent value="deal-sheet" className="mt-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Deal Sheet</h2>
            <Link href={`/tickets/${ticket.id}/deal-sheet`}>
              <Button size="sm" variant="outline">
                Open Full Deal Sheet
              </Button>
            </Link>
          </div>
          {ticket.dealSheets.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#888888]">
                No deal sheet versions yet.{" "}
                <Link
                  href={`/tickets/${ticket.id}/deal-sheet`}
                  className="text-[#FF6600] underline"
                >
                  Create one
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {ticket.dealSheets.slice(0, 3).map((ds) => (
                <Card key={ds.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">v{ds.versionNo}</Badge>
                        <Badge variant="outline">{ds.status}</Badge>
                        <span className="text-sm text-[#888888]">
                          {ds.mode}
                        </span>
                      </div>
                      <div className="flex gap-4 text-sm tabular-nums">
                        <span>Cost: {dec(ds.totalExpectedCost)}</span>
                        <span>Sell: {dec(ds.totalExpectedSell)}</span>
                        <span
                          className={
                            Number(ds.totalExpectedMargin?.toString() || 0) >= 0
                              ? "text-[#00CC66]"
                              : "text-[#FF3333]"
                          }
                        >
                          Margin: {dec(ds.totalExpectedMargin)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* ── COMPETITIVE BID PANEL ── */}
          <div className="mt-6">
            <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-3">Competitive Bids</h2>
            <CompetitiveBidPanel ticketId={ticket.id} />
          </div>
        </TabsContent>

        {/* ── BUNDLES TAB ─────────────────────────────────────────── */}
        <TabsContent value="bundles" className="mt-4">
          <SalesBundlesPanel
            ticketId={ticket.id}
            bundles={salesBundles}
            ticketLines={ticket.lines.map((l) => ({
              id: l.id,
              description: l.description,
            }))}
          />
        </TabsContent>

        {/* ── QUOTES TAB ──────────────────────────────────────────── */}
        <TabsContent value="quotes" className="mt-4">
          <QuotePanel
            ticketId={ticket.id}
            quotes={quotes}
            customers={customers}
            sites={sites}
            commercialLinks={commercialLinks}
          />
        </TabsContent>

        {/* ── PROCUREMENT TAB ────────────────────────────────────── */}
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

        {/* ── PO REGISTER TAB ───────────────────────────────────── */}
        <TabsContent value="po-register" className="mt-4">
          <TicketPOTab
            ticketId={ticket.id}
            customerPOs={customerPOs || []}
            ticketLines={ticket.lines.map((l) => ({
              id: l.id,
              description: l.description,
            }))}
          />
        </TabsContent>

        {/* ── INVOICES TAB ──────────────────────────────────────── */}
        <TabsContent value="invoices" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">Sales Invoices</h2>
          {salesInvoices.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#888888]">
                No invoices for this ticket yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {salesInvoices.map((inv) => (
                <Card key={inv.id}>
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-sm">
                          {inv.invoiceNo || "Draft"}
                        </span>
                        <Badge
                          variant={
                            inv.status === "PAID"
                              ? "default"
                              : inv.status === "SENT"
                              ? "secondary"
                              : inv.status === "OVERDUE"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {inv.status}
                        </Badge>
                        <span className="text-sm text-[#888888]">
                          {inv.customer.name}
                        </span>
                        {inv.poNo && (
                          <span className="text-xs text-[#888888]">
                            PO: {inv.poNo}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium tabular-nums">
                          {dec(inv.totalSell)}
                        </span>
                        {inv.status === "DRAFT" && (
                          <TicketInvoiceSendButton invoiceId={inv.id} />
                        )}
                        {inv.status === "SENT" && (
                          <TicketInvoiceMarkPaidButton invoiceId={inv.id} />
                        )}
                      </div>
                    </div>
                    {inv.lines.length > 0 && (
                      <div className="mt-2 text-xs text-[#888888]">
                        {inv.lines.length} line{inv.lines.length !== 1 ? "s" : ""} |{" "}
                        {inv.lines.filter((l) => l.poMatched).length} PO matched
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── RECOVERY TAB ─────────────────────────────────────── */}
        <TabsContent value="recovery" className="mt-4">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold mb-4">Recovery Cases</h2>
          {ticket.recoveryCases.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-[#888888]">
                No recovery cases for this ticket.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {ticket.recoveryCases.map((rc) => {
                const daysInStage = rc.currentStageStartedAt
                  ? Math.floor(
                      (Date.now() - new Date(rc.currentStageStartedAt).getTime()) /
                        (1000 * 60 * 60 * 24)
                    )
                  : 0;

                return (
                  <Card key={rc.id}>
                    <CardContent className="py-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {rc.reasonType.replace(/_/g, " ")}
                          </Badge>
                          <Badge
                            variant={
                              rc.recoveryStatus === "CLOSED"
                                ? "default"
                                : "destructive"
                            }
                          >
                            {rc.recoveryStatus.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-sm text-[#888888]">
                            {daysInStage}d in stage
                          </span>
                        </div>
                        <span className="text-sm font-medium tabular-nums text-[#FF3333]">
                          {dec(rc.stuckValue)}
                        </span>
                      </div>
                      {rc.nextAction && (
                        <p className="text-sm text-[#888888]">
                          Next: {rc.nextAction}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Link href="/recovery">
                          <Button size="sm" variant="outline">
                            Open in Recovery
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TicketInvoiceSendButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/sales-invoices/${invoiceId}/send`, {
        method: "POST",
      });
      if (res.ok) router.refresh();
    } finally {
      setSending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleSend} disabled={sending}>
      {sending ? "Sending..." : "Send"}
    </Button>
  );
}

function TicketInvoiceMarkPaidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [marking, setMarking] = useState(false);

  async function handleMarkPaid() {
    setMarking(true);
    try {
      const res = await fetch(`/api/sales-invoices/${invoiceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", paidAt: new Date().toISOString() }),
      });
      if (res.ok) router.refresh();
    } finally {
      setMarking(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleMarkPaid} disabled={marking}>
      {marking ? "Updating..." : "Mark Paid"}
    </Button>
  );
}

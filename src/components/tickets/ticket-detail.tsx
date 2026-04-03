"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowLeft } from "lucide-react";
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
import { TicketPOTab } from "@/components/po-register/ticket-po-tab";
import { EvidencePanel } from "@/components/evidence/evidence-panel";

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

type TicketData = {
  id: string;
  title: string;
  description: string | null;
  ticketMode: string;
  status: string;
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
}) {
  const router = useRouter();
  const [lineSheetOpen, setLineSheetOpen] = useState(false);
  const [submittingLine, setSubmittingLine] = useState(false);
  const [lineType, setLineType] = useState<string>("MATERIAL");
  const [lineUnit, setLineUnit] = useState<string>("EA");
  const [editingLine, setEditingLine] = useState<TicketLine | null>(null);
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
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

    const body = {
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
          {!isQuoteReady && ticket.lines.length > 0 && (
            <div className="text-[10px] text-[#888888] bb-mono">
              {ticket.lines.filter((l) => l.status === "READY_FOR_QUOTE").length}/{ticket.lines.length} LINES READY
            </div>
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
            Lines ({ticket.lines.length})
          </TabsTrigger>
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

          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Exp. Cost</TableHead>
                  <TableHead className="text-right">Actual Cost</TableHead>
                  <TableHead className="text-right">Sale Price</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ticket.lines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center py-8 text-[#888888]"
                    >
                      No lines yet. Add your first line item.
                    </TableCell>
                  </TableRow>
                ) : (
                  ticket.lines.map((line) => {
                    const margin = Number(line.actualMarginTotal || 0);
                    const sc = line.status === "READY_FOR_QUOTE"
                      ? "text-[#00CC66] bg-[#00CC66]/10"
                      : line.status === "PRICED"
                      ? "text-[#FF9900] bg-[#FF9900]/10"
                      : "text-[#888888] bg-[#333333]";
                    return (
                    <TableRow key={line.id} className="cursor-pointer hover:bg-[#222222]" onClick={() => { setEditingLine(line); setEditSheetOpen(true); }}>
                      <TableCell className="font-medium max-w-[250px]">
                        <div>{line.description}</div>
                        {line.internalNotes && (
                          <div className="text-[10px] text-[#666666] mt-0.5 whitespace-pre-line leading-tight">{line.internalNotes}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px]">
                          {line.lineType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dec(line.qty)}
                      </TableCell>
                      <TableCell className="text-[#888888] text-[10px]">
                        {line.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dec(line.expectedCostTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dec(line.actualCostTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dec(line.actualSaleTotal)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={margin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>{dec(line.actualMarginTotal)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${sc}`}>
                          {line.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
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
                  <SheetFooter className="mt-2">
                    <Button type="submit" disabled={savingEdit} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
                      {savingEdit ? "Saving..." : "Save Changes"}
                    </Button>
                  </SheetFooter>
                </form>
              )}
            </SheetContent>
          </Sheet>
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
                  className="flex items-start gap-3 border-l-2 border-[#333333] pl-4 py-2"
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
                        Ref: {ev.sourceRef}
                      </p>
                    )}
                  </div>
                </div>
              ))}
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
          />
        </TabsContent>

        {/* ── PROCUREMENT TAB ────────────────────────────────────── */}
        <TabsContent value="procurement" className="mt-4">
          <TicketProcurementTab
            ticketId={ticket.id}
            procurementOrders={procurementOrders}
            supplierBills={[]}
            costAllocations={costAllocations}
            absorbedCosts={absorbedCostAllocations}
            suppliers={suppliers}
            ticketLines={ticket.lines.map((l) => ({
              id: l.id,
              description: l.description,
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

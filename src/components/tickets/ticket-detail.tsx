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
      unit: (formData.get("unit") as string) || "EA",
      payingCustomerId: ticket.payingCustomer.id,
      expectedCostUnit: Number(formData.get("expectedCostUnit")) || undefined,
      suggestedSaleUnit:
        Number(formData.get("suggestedSaleUnit")) || undefined,
      status: "CAPTURED",
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
            <h1 className="text-2xl font-semibold tracking-tight">
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
            <span className="text-sm text-muted-foreground">
              {ticket.payingCustomer.name}
            </span>
            {ticket.site && (
              <>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm text-muted-foreground">
                  {ticket.site.siteName}
                </span>
              </>
            )}
            <span className="text-xs text-muted-foreground ml-2">
              ID: {ticket.id.slice(0, 8)}
            </span>
          </div>
        </div>
      </div>

      {/* Status Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span>
            {ticket.status.replace(/_/g, " ")} ({progressPercent}%)
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between">
          {STATUS_ORDER.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-1.5 rounded-full ${
                i <= statusIndex ? "bg-primary" : "bg-muted-foreground/30"
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
            <p className="text-sm text-muted-foreground">
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
            <h2 className="text-lg font-medium">Ticket Lines</h2>
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
                      <Label htmlFor="unit">Unit</Label>
                      <Input
                        id="unit"
                        name="unit"
                        defaultValue="EA"
                        placeholder="EA, M, KG, HR..."
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="expectedCostUnit">
                      Expected Cost / Unit
                    </Label>
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
                      Suggested Sale / Unit
                    </Label>
                    <Input
                      id="suggestedSaleUnit"
                      name="suggestedSaleUnit"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                    />
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

          <div className="rounded-lg border bg-background">
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
                      className="text-center py-8 text-muted-foreground"
                    >
                      No lines yet. Add your first line item.
                    </TableCell>
                  </TableRow>
                ) : (
                  ticket.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {line.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {line.lineType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {dec(line.qty)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
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
                        {dec(line.actualMarginTotal)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {line.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
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
          <h2 className="text-lg font-medium mb-4">Tasks</h2>
          {ticket.tasks.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No tasks generated yet.
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-lg border bg-background">
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
                      <TableCell className="text-muted-foreground max-w-[200px] truncate">
                        {task.generatedReason || "\u2014"}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {task.dueAt
                          ? new Date(task.dueAt).toLocaleDateString()
                          : "\u2014"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
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
          <h2 className="text-lg font-medium mb-4">Events</h2>
          {ticket.events.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No events recorded yet.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {ticket.events.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-3 border-l-2 border-muted pl-4 py-2"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {ev.eventType.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(ev.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {ev.notes && (
                      <p className="text-sm text-muted-foreground mt-1">
                        {ev.notes}
                      </p>
                    )}
                    {ev.sourceRef && (
                      <p className="text-xs text-muted-foreground mt-0.5">
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
          <h2 className="text-lg font-medium mb-4">Timeline</h2>
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
                  <CardContent className="py-8 text-center text-muted-foreground">
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
                    className="flex items-start gap-3 border-l-2 border-muted pl-4 py-2"
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
                        <span className="text-xs text-muted-foreground">
                          {item.timestamp.toLocaleString()}
                        </span>
                      </div>
                      {item.notes && (
                        <p className="text-sm text-muted-foreground mt-1">
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
            <h2 className="text-lg font-medium">Deal Sheet</h2>
            <Link href={`/tickets/${ticket.id}/deal-sheet`}>
              <Button size="sm" variant="outline">
                Open Full Deal Sheet
              </Button>
            </Link>
          </div>
          {ticket.dealSheets.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No deal sheet versions yet.{" "}
                <Link
                  href={`/tickets/${ticket.id}/deal-sheet`}
                  className="text-primary underline"
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
                        <span className="text-sm text-muted-foreground">
                          {ds.mode}
                        </span>
                      </div>
                      <div className="flex gap-4 text-sm tabular-nums">
                        <span>Cost: {dec(ds.totalExpectedCost)}</span>
                        <span>Sell: {dec(ds.totalExpectedSell)}</span>
                        <span
                          className={
                            Number(ds.totalExpectedMargin?.toString() || 0) >= 0
                              ? "text-green-600"
                              : "text-red-600"
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
          <h2 className="text-lg font-medium mb-4">Sales Invoices</h2>
          {salesInvoices.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
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
                        <span className="text-sm text-muted-foreground">
                          {inv.customer.name}
                        </span>
                        {inv.poNo && (
                          <span className="text-xs text-muted-foreground">
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
                      <div className="mt-2 text-xs text-muted-foreground">
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
          <h2 className="text-lg font-medium mb-4">Recovery Cases</h2>
          {ticket.recoveryCases.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
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
                          <span className="text-sm text-muted-foreground">
                            {daysInStage}d in stage
                          </span>
                        </div>
                        <span className="text-sm font-medium tabular-nums text-red-600">
                          {dec(rc.stuckValue)}
                        </span>
                      </div>
                      {rc.nextAction && (
                        <p className="text-sm text-muted-foreground">
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

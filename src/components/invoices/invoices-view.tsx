"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  AlertTriangle,
  Send,
  Link2,
  Link2Off,
  CreditCard,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  MessageSquare,
  ArrowRightLeft,
  Package,
  MapPin,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function num(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

type InvoiceLine = {
  id: string;
  description: string;
  qty: Decimal;
  unitPrice: Decimal;
  lineTotal: Decimal;
  poMatched: boolean;
  poMatchStatus: string | null;
};

type Invoice = {
  id: string;
  invoiceNo: string | null;
  ticketId: string;
  customerId: string;
  siteId: string | null;
  poNo: string | null;
  invoiceType: string;
  status: string;
  issuedAt: string | null;
  paidAt: string | null;
  totalSell: Decimal;
  notes: string | null;
  createdAt: string;
  ticket: { id: string; title: string };
  customer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  lines: InvoiceLine[];
  poAllocations: { id: string; allocatedValue: Decimal; status: string }[];
};

// ─── Commercial linkage types ───────────────────────────────────────────────

type CommercialAllocation = {
  id: string;
  allocatedQty: Decimal;
  confidence: Decimal;
  manualOverride: boolean;
  notes: string | null;
  orderGroup: {
    id: string;
    label: string;
    orderedQty: Decimal;
    closureStatus: string;
    site: { id: string; siteName: string } | null;
    orderEvents: {
      id: string;
      eventType: string;
      qty: Decimal;
      rawUom: string;
      sourceMessageId: string | null;
      sourceText: string | null;
      timestamp: string;
      canonicalProduct: { code: string; name: string } | null;
    }[];
  };
};

type CommercialInvoiceLine = {
  id: string;
  description: string;
  rawProductText: string | null;
  qty: Decimal;
  rawUom: string;
  sellRate: Decimal;
  sellAmount: Decimal;
  allocationStatus: string;
  allocationConfidence: Decimal;
  manualOverride: boolean;
  canonicalProduct: { code: string; name: string; category: string | null } | null;
  allocations: CommercialAllocation[];
};

type CommercialInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceStatus: string;
  invoiceDate: string;
  total: Decimal;
  paidAmount: Decimal;
  balance: Decimal;
  siteId: string | null;
  customerId: string | null;
  lines: CommercialInvoiceLine[];
};

type CustomerOption = { id: string; name: string };

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "DRAFT": return "outline";
    case "SENT": return "secondary";
    case "PAID": return "default";
    case "OVERDUE": return "destructive";
    default: return "outline";
  }
}

function getReadinessBlockers(inv: Invoice): string[] {
  const blockers: string[] = [];
  if (!inv.invoiceNo) blockers.push("Missing invoice number");
  if (!inv.poNo && inv.poAllocations.length === 0) blockers.push("No PO linked");
  if (inv.lines.length === 0) blockers.push("No invoice lines");
  if (inv.lines.some((l) => !l.poMatched)) blockers.push("Unmatched lines to PO");
  return blockers;
}

// ─── Commercial linkage helpers ─────────────────────────────────────────────

function getLinkedOrderGroups(ci: CommercialInvoice | undefined): { id: string; label: string; closureStatus: string }[] {
  if (!ci) return [];
  const groups = new Map<string, { id: string; label: string; closureStatus: string }>();
  for (const line of ci.lines) {
    for (const alloc of line.allocations) {
      if (!groups.has(alloc.orderGroup.id)) {
        groups.set(alloc.orderGroup.id, {
          id: alloc.orderGroup.id,
          label: alloc.orderGroup.label,
          closureStatus: alloc.orderGroup.closureStatus,
        });
      }
    }
  }
  return Array.from(groups.values());
}

function getUnallocatedLineCount(ci: CommercialInvoice | undefined): number {
  if (!ci) return 0;
  return ci.lines.filter((l) => l.allocationStatus === "UNALLOCATED").length;
}

function spansMultipleOrders(ci: CommercialInvoice | undefined): boolean {
  return getLinkedOrderGroups(ci).length > 1;
}

const ALLOC_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  UNALLOCATED: { color: "#FF4444", label: "UNALLOCATED" },
  PARTIALLY_ALLOCATED: { color: "#FFAA00", label: "PARTIAL" },
  ALLOCATED: { color: "#00CC66", label: "ALLOCATED" },
};

// ─── Component ──────────────────────────────────────────────────────────────

export function InvoicesView({
  invoices,
  customers,
  commercialLinkMap,
}: {
  invoices: Invoice[];
  customers: CustomerOption[];
  commercialLinkMap?: Record<string, CommercialInvoice>;
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkPoOpen, setLinkPoOpen] = useState(false);
  const [linkPoId, setLinkPoId] = useState("");
  const [poNoInput, setPoNoInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sourceMessageModal, setSourceMessageModal] = useState<{ events: CommercialAllocation["orderGroup"]["orderEvents"]; groupLabel: string } | null>(null);

  const linkMap = commercialLinkMap || {};

  const drafts = invoices.filter((i) => i.status === "DRAFT");
  const sent = invoices.filter((i) => i.status === "SENT");
  const paid = invoices.filter((i) => i.status === "PAID");
  const outstanding = invoices.filter((i) => i.status !== "PAID" && i.status !== "DRAFT");

  const draftTotal = drafts.reduce((s, i) => s + num(i.totalSell), 0);
  const sentTotal = sent.reduce((s, i) => s + num(i.totalSell), 0);
  const paidTotal = paid.reduce((s, i) => s + num(i.totalSell), 0);
  const outstandingTotal = outstanding.reduce((s, i) => s + num(i.totalSell), 0);

  const filtered = invoices.filter((inv) => {
    if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
    if (customerFilter !== "ALL" && inv.customerId !== customerFilter) return false;
    return true;
  });

  async function handleSend(id: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales-invoices/${id}/send`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkPaid(id: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", paidAt: new Date().toISOString() }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLinkPo() {
    if (!poNoInput.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales-invoices/${linkPoId}/link-po`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ poNo: poNoInput.trim() }),
      });
      if (res.ok) {
        setLinkPoOpen(false);
        setPoNoInput("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Drafts</p>
            <p className="text-2xl font-bold">{drafts.length}</p>
            <p className="text-sm text-[#888888]">{dec(draftTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Sent</p>
            <p className="text-2xl font-bold">{sent.length}</p>
            <p className="text-sm text-[#888888]">{dec(sentTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Paid</p>
            <p className="text-2xl font-bold">{paid.length}</p>
            <p className="text-sm text-[#888888]">{dec(paidTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Total Outstanding</p>
            <p className="text-2xl font-bold text-[#FF9900]">{dec(outstandingTotal)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="w-48">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "ALL")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-56">
          <Select value={customerFilter} onValueChange={(v) => setCustomerFilter(v ?? "ALL")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Customers</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Invoice No</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>PO No</TableHead>
              <TableHead className="text-right">Total Sell</TableHead>
              <TableHead>Order Linkage</TableHead>
              <TableHead>PO Match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-[#888888]">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => {
                const isExpanded = expandedId === inv.id;
                const allMatched = inv.lines.length > 0 && inv.lines.every((l) => l.poMatched);
                const blockers = inv.status === "DRAFT" ? getReadinessBlockers(inv) : [];

                // Commercial linkage for this invoice
                const ci = inv.invoiceNo ? linkMap[inv.invoiceNo] : undefined;
                const linkedGroups = getLinkedOrderGroups(ci);
                const unallocCount = getUnallocatedLineCount(ci);
                const multiOrder = spansMultipleOrders(ci);

                return (
                  <Fragment key={inv.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-[#222222]"
                      onClick={() => setExpandedId(isExpanded ? null : inv.id)}
                    >
                      <TableCell>
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{inv.invoiceNo || "\u2014"}</TableCell>
                      <TableCell className="max-w-[150px] truncate">{inv.ticket.title}</TableCell>
                      <TableCell>{inv.customer.name}</TableCell>
                      <TableCell>{inv.site?.siteName || "\u2014"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{inv.invoiceType.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(inv.status)}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{inv.poNo || "\u2014"}</TableCell>
                      <TableCell className="text-right tabular-nums">{dec(inv.totalSell)}</TableCell>
                      <TableCell>
                        <OrderLinkageSummary
                          linkedGroups={linkedGroups}
                          unallocCount={unallocCount}
                          multiOrder={multiOrder}
                          hasCommercial={!!ci}
                        />
                      </TableCell>
                      <TableCell>
                        {allMatched ? (
                          <Check className="size-4 text-[#00CC66]" />
                        ) : (
                          <AlertTriangle className="size-4 text-[#FF9900]" />
                        )}
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={11} className="bg-[#1A1A1A] p-4">
                          <div className="space-y-4">
                            {/* Order Linkage Header Panel */}
                            {ci && (
                              <OrderLinkagePanel
                                ci={ci}
                                linkedGroups={linkedGroups}
                                unallocCount={unallocCount}
                                multiOrder={multiOrder}
                                onViewMessages={(events, label) => setSourceMessageModal({ events, groupLabel: label })}
                              />
                            )}

                            {/* Invoice Lines with Commercial Linkage */}
                            <div>
                              <h4 className="text-sm font-medium mb-2">Invoice Lines</h4>
                              <div className="border border-[#333333] bg-[#1A1A1A]">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Description</TableHead>
                                      <TableHead className="text-right">Qty</TableHead>
                                      <TableHead className="text-right">Unit Price</TableHead>
                                      <TableHead className="text-right">Line Total</TableHead>
                                      <TableHead>Order Linkage</TableHead>
                                      <TableHead>PO Matched</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {inv.lines.length === 0 ? (
                                      <TableRow>
                                        <TableCell colSpan={6} className="text-center py-4 text-[#888888]">
                                          No lines
                                        </TableCell>
                                      </TableRow>
                                    ) : (
                                      inv.lines.map((line) => {
                                        // Find matching commercial line by description similarity
                                        const ciLine = ci ? findMatchingCommercialLine(ci, line) : undefined;

                                        return (
                                          <Fragment key={line.id}>
                                            <TableRow>
                                              <TableCell>{line.description}</TableCell>
                                              <TableCell className="text-right tabular-nums">{dec(line.qty)}</TableCell>
                                              <TableCell className="text-right tabular-nums">{dec(line.unitPrice)}</TableCell>
                                              <TableCell className="text-right tabular-nums">{dec(line.lineTotal)}</TableCell>
                                              <TableCell>
                                                <LineLinkageBadge ciLine={ciLine} />
                                              </TableCell>
                                              <TableCell>
                                                {line.poMatched ? (
                                                  <Badge variant="default">Matched</Badge>
                                                ) : (
                                                  <Badge variant="outline">Unmatched</Badge>
                                                )}
                                              </TableCell>
                                            </TableRow>

                                            {/* Allocation detail row */}
                                            {ciLine && ciLine.allocations.length > 0 && (
                                              <TableRow>
                                                <TableCell colSpan={6} className="py-0 px-6">
                                                  <AllocationDetail
                                                    ciLine={ciLine}
                                                    onViewMessages={(events, label) => setSourceMessageModal({ events, groupLabel: label })}
                                                  />
                                                </TableCell>
                                              </TableRow>
                                            )}
                                          </Fragment>
                                        );
                                      })
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>

                            {/* Readiness warnings */}
                            {blockers.length > 0 && (
                              <div className="rounded border border-[#FF9900]/30 bg-[#FF9900]/10 p-3">
                                <h4 className="text-sm font-medium text-[#FF9900] mb-1">
                                  Invoice Readiness Blockers
                                </h4>
                                <ul className="text-sm text-[#FF9900] list-disc pl-4 space-y-0.5">
                                  {blockers.map((b, i) => (
                                    <li key={i}>{b}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                              {inv.status === "DRAFT" && (
                                <Button
                                  size="sm"
                                  onClick={(e) => { e.stopPropagation(); handleSend(inv.id); }}
                                  disabled={submitting}
                                >
                                  <Send className="size-4 mr-1" />
                                  Send
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLinkPoId(inv.id);
                                  setPoNoInput(inv.poNo || "");
                                  setLinkPoOpen(true);
                                }}
                              >
                                <Link2 className="size-4 mr-1" />
                                Link PO
                              </Button>
                              {inv.status === "SENT" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => { e.stopPropagation(); handleMarkPaid(inv.id); }}
                                  disabled={submitting}
                                >
                                  <CreditCard className="size-4 mr-1" />
                                  Mark Paid
                                </Button>
                              )}
                              {ci && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    window.location.href = "/commercial";
                                  }}
                                >
                                  <ExternalLink className="size-4 mr-1" />
                                  View Reconciliation
                                </Button>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Link PO Dialog */}
      <Dialog open={linkPoOpen} onOpenChange={setLinkPoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Purchase Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="po-no-input">PO Number</Label>
            <Input
              id="po-no-input"
              value={poNoInput}
              onChange={(e) => setPoNoInput(e.target.value)}
              placeholder="Enter PO number"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkPoOpen(false)}>Cancel</Button>
            <Button onClick={handleLinkPo} disabled={submitting || !poNoInput.trim()}>
              {submitting ? "Linking..." : "Link PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Source Messages Modal */}
      <Dialog open={!!sourceMessageModal} onOpenChange={() => setSourceMessageModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="size-4" />
              Source Messages — {sourceMessageModal?.groupLabel}
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto space-y-2 py-2">
            {sourceMessageModal?.events.map((ev) => (
              <div key={ev.id} className="border border-[#333333] rounded p-3 space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-[#888888]">
                    {new Date(ev.timestamp).toLocaleDateString("en-GB")}{" "}
                    {new Date(ev.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {ev.eventType.replace(/_/g, " ")}
                  </Badge>
                  {ev.canonicalProduct && (
                    <Badge variant="secondary" className="text-[10px]">
                      {ev.canonicalProduct.code}
                    </Badge>
                  )}
                  <span className="text-[#888888]">
                    {num(ev.qty)} {ev.rawUom}
                  </span>
                </div>
                {ev.sourceText && (
                  <div className="text-xs text-[#CCCCCC] italic whitespace-pre-wrap">
                    &quot;{ev.sourceText}&quot;
                  </div>
                )}
                {ev.sourceMessageId && (
                  <div className="text-[10px] text-[#555555]">
                    MSG: {ev.sourceMessageId}
                  </div>
                )}
              </div>
            ))}
            {(!sourceMessageModal?.events || sourceMessageModal.events.length === 0) && (
              <div className="text-center py-4 text-[#888888] text-sm">
                No source messages linked to this order group.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function OrderLinkageSummary({
  linkedGroups,
  unallocCount,
  multiOrder,
  hasCommercial,
}: {
  linkedGroups: { id: string; label: string; closureStatus: string }[];
  unallocCount: number;
  multiOrder: boolean;
  hasCommercial: boolean;
}) {
  if (!hasCommercial) {
    return <span className="text-[#555555] text-xs">\u2014</span>;
  }

  if (linkedGroups.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-[#FF4444] bg-[#FF444415] px-1.5 py-0.5 rounded">
        <Link2Off className="size-3" />
        UNALLOCATED
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-[10px] text-[#00CC66] bg-[#00CC6615] px-1.5 py-0.5 rounded">
        <Link2 className="size-3" />
        {linkedGroups.length} ORDER{linkedGroups.length !== 1 ? "S" : ""}
      </span>
      {unallocCount > 0 && (
        <span className="text-[10px] text-[#FFAA00]">
          {unallocCount} unlinked line{unallocCount !== 1 ? "s" : ""}
        </span>
      )}
      {multiOrder && (
        <span className="text-[10px] text-[#AA66FF]">MULTI-ORDER</span>
      )}
    </div>
  );
}

function OrderLinkagePanel({
  ci,
  linkedGroups,
  unallocCount,
  multiOrder,
  onViewMessages,
}: {
  ci: CommercialInvoice;
  linkedGroups: { id: string; label: string; closureStatus: string }[];
  unallocCount: number;
  multiOrder: boolean;
  onViewMessages: (events: CommercialAllocation["orderGroup"]["orderEvents"], label: string) => void;
}) {
  // Collect unique sites and source events from linked groups
  const allSites = new Set<string>();
  const allCustomers = new Set<string>();

  for (const line of ci.lines) {
    for (const alloc of line.allocations) {
      if (alloc.orderGroup.site) allSites.add(alloc.orderGroup.site.siteName);
    }
  }

  return (
    <div className="rounded border border-[#333333] bg-[#111111] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold tracking-wider text-[#FF6600] bb-mono">ORDER LINKAGE</h4>
        <div className="flex items-center gap-3 text-[10px] bb-mono text-[#888888]">
          <span>INV: <span className="text-[#E0E0E0]">{ci.invoiceNumber}</span></span>
          <span>STATUS: <span style={{ color: ci.invoiceStatus === "PAID" ? "#00CC66" : ci.invoiceStatus === "OVERDUE" ? "#FF4444" : "#FFAA00" }}>{ci.invoiceStatus}</span></span>
          {unallocCount > 0 && (
            <span className="text-[#FF4444]">{unallocCount} UNALLOCATED LINE{unallocCount !== 1 ? "S" : ""}</span>
          )}
          {multiOrder && (
            <span className="text-[#AA66FF]">SPANS MULTIPLE ORDERS</span>
          )}
        </div>
      </div>

      {/* Linked order groups */}
      {linkedGroups.length > 0 ? (
        <div className="space-y-1.5">
          {linkedGroups.map((group) => {
            // Find events for this group
            const groupEvents = ci.lines
              .flatMap((l) => l.allocations)
              .filter((a) => a.orderGroup.id === group.id)
              .flatMap((a) => a.orderGroup.orderEvents);
            const site = ci.lines
              .flatMap((l) => l.allocations)
              .find((a) => a.orderGroup.id === group.id)?.orderGroup.site;

            return (
              <div key={group.id} className="flex items-center gap-3 text-xs py-1 border-b border-[#1A1A1A] last:border-0">
                <Package className="size-3.5 text-[#4488FF] shrink-0" />
                <span className="text-[#E0E0E0] flex-1 truncate">{group.label}</span>
                {site && (
                  <span className="flex items-center gap-1 text-[10px] text-[#888888]">
                    <MapPin className="size-3" />
                    {site.siteName}
                  </span>
                )}
                <Badge variant="outline" className="text-[10px]">{group.closureStatus}</Badge>
                <button
                  onClick={() => onViewMessages(groupEvents, group.label)}
                  className="flex items-center gap-1 text-[10px] text-[#4488FF] hover:text-[#6699FF] transition-colors"
                >
                  <MessageSquare className="size-3" />
                  Sources
                </button>
                <a
                  href="/commercial"
                  className="flex items-center gap-1 text-[10px] text-[#FF6600] hover:text-[#FF8833] transition-colors"
                >
                  <ExternalLink className="size-3" />
                  Reconciliation
                </a>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-[#FF4444]">
          <Link2Off className="size-3.5" />
          All lines unallocated — no order groups linked
        </div>
      )}
    </div>
  );
}

function LineLinkageBadge({ ciLine }: { ciLine: CommercialInvoiceLine | undefined }) {
  if (!ciLine) {
    return <span className="text-[#555555] text-xs">\u2014</span>;
  }

  const config = ALLOC_STATUS_CONFIG[ciLine.allocationStatus] || ALLOC_STATUS_CONFIG.UNALLOCATED;

  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
        style={{ color: config.color, backgroundColor: `${config.color}15` }}
      >
        {ciLine.allocationStatus === "UNALLOCATED" ? (
          <Link2Off className="size-3" />
        ) : (
          <Link2 className="size-3" />
        )}
        {config.label}
      </span>
      {ciLine.canonicalProduct && (
        <span className="text-[10px] text-[#4488FF]">{ciLine.canonicalProduct.code}</span>
      )}
      {ciLine.allocations.length > 0 && (
        <span className="text-[10px] text-[#888888] truncate max-w-[160px]">
          → {ciLine.allocations[0].orderGroup.label}
        </span>
      )}
    </div>
  );
}

function AllocationDetail({
  ciLine,
  onViewMessages,
}: {
  ciLine: CommercialInvoiceLine;
  onViewMessages: (events: CommercialAllocation["orderGroup"]["orderEvents"], label: string) => void;
}) {
  return (
    <div className="py-2 space-y-1.5">
      {ciLine.allocations.map((alloc) => (
        <div key={alloc.id} className="flex items-center gap-3 text-[10px] bb-mono">
          <ArrowRightLeft className="size-3 text-[#4488FF] shrink-0" />
          <span className="text-[#E0E0E0]">{alloc.orderGroup.label}</span>
          <span className="text-[#888888]">Qty: {dec(alloc.allocatedQty)}</span>
          {alloc.confidence !== null && (
            <span className="text-[#888888]">
              Confidence: <span style={{ color: num(alloc.confidence) >= 75 ? "#00CC66" : num(alloc.confidence) >= 50 ? "#FFAA00" : "#FF4444" }}>
                {num(alloc.confidence)}%
              </span>
            </span>
          )}
          {alloc.manualOverride && (
            <Badge variant="outline" className="text-[9px]">MANUAL</Badge>
          )}
          {alloc.orderGroup.site && (
            <span className="flex items-center gap-1 text-[#888888]">
              <MapPin className="size-2.5" />
              {alloc.orderGroup.site.siteName}
            </span>
          )}
          <Badge variant="outline" className="text-[9px]">{alloc.orderGroup.closureStatus}</Badge>

          {/* Quick actions */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onViewMessages(alloc.orderGroup.orderEvents, alloc.orderGroup.label)}
              className="flex items-center gap-1 text-[#4488FF] hover:text-[#6699FF] transition-colors"
              title="View source messages"
            >
              <MessageSquare className="size-3" />
            </button>
            <a
              href="/commercial"
              className="flex items-center gap-1 text-[#FF6600] hover:text-[#FF8833] transition-colors"
              title="View in reconciliation"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      ))}
      {ciLine.allocations.some((a) => a.notes) && (
        <div className="text-[9px] text-[#555555] pl-5">
          {ciLine.allocations.filter((a) => a.notes).map((a) => a.notes).join("; ")}
        </div>
      )}
    </div>
  );
}

// ─── Matching helper ────────────────────────────────────────────────────────

function findMatchingCommercialLine(
  ci: CommercialInvoice,
  salesLine: InvoiceLine
): CommercialInvoiceLine | undefined {
  // Try matching by description similarity
  const desc = salesLine.description.toLowerCase();
  const qty = num(salesLine.qty);

  // First pass: exact description match
  let match = ci.lines.find((l) =>
    l.description.toLowerCase() === desc
  );
  if (match) return match;

  // Second pass: description contains + qty match
  match = ci.lines.find((l) =>
    l.description.toLowerCase().includes(desc.slice(0, 20)) &&
    Math.abs(num(l.qty) - qty) < 0.01
  );
  if (match) return match;

  // Third pass: canonical product code in description
  match = ci.lines.find((l) =>
    l.canonicalProduct &&
    desc.includes(l.canonicalProduct.name.toLowerCase().slice(0, 10)) &&
    Math.abs(num(l.qty) - qty) < 0.01
  );
  if (match) return match;

  return undefined;
}

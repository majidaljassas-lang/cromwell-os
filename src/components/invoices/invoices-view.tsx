"use client";

import { Fragment, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  AlertTriangle,
  Send,
  Link2,
  CreditCard,
  ChevronDown,
  ChevronRight,
  FileText,
  Download,
  Clock,
  Bell,
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

function pct(val: number): string {
  return val.toFixed(1) + "%";
}

type TicketLineRef = {
  id: string;
  expectedCostUnit: Decimal;
  expectedCostTotal: Decimal;
  actualCostTotal: Decimal;
};

type InvoiceLine = {
  id: string;
  description: string;
  qty: Decimal;
  unitPrice: Decimal;
  lineTotal: Decimal;
  poMatched: boolean;
  poMatchStatus: string | null;
  ticketLine: TicketLineRef;
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
  ticket: {
    id: string;
    title: string;
    site: { id: string; siteName: string } | null;
  };
  customer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  lines: InvoiceLine[];
  poAllocations: { id: string; allocatedValue: Decimal; status: string }[];
};

type CustomerOption = { id: string; name: string };

// ─── Status config ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; color: string }> = {
  DRAFT:             { label: "Draft",            variant: "outline",      color: "#888888" },
  AWAITING_PO:       { label: "Awaiting PO",      variant: "outline",      color: "#FFAA00" },
  AWAITING_EVIDENCE: { label: "Awaiting Evidence", variant: "outline",     color: "#FFAA00" },
  READY_TO_SEND:     { label: "Ready to Send",    variant: "secondary",    color: "#4488FF" },
  SENT:              { label: "Sent",              variant: "secondary",    color: "#4488FF" },
  OVERDUE:           { label: "Overdue",           variant: "destructive",  color: "#FF4444" },
  PARTIALLY_PAID:    { label: "Partially Paid",   variant: "secondary",    color: "#FFAA00" },
  PAID:              { label: "Paid",              variant: "default",      color: "#00CC66" },
  DISPUTED:          { label: "Disputed",          variant: "destructive",  color: "#FF4444" },
  CREDITED:          { label: "Credited",          variant: "outline",      color: "#AA66FF" },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  return STATUS_CONFIG[status]?.variant ?? "outline";
}

function statusLabel(status: string): string {
  return STATUS_CONFIG[status]?.label ?? status;
}

function statusColor(status: string): string {
  return STATUS_CONFIG[status]?.color ?? "#888888";
}

// ─── Overdue helpers ──────────────────────────────────────────────────────

function daysSinceSent(inv: Invoice): number | null {
  if (!inv.issuedAt) return null;
  const sent = new Date(inv.issuedAt);
  const now = new Date();
  return Math.floor((now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24));
}

function overdueColor(days: number): string {
  if (days < 30) return "#00CC66";
  if (days <= 60) return "#FF9900";
  return "#FF4444";
}

function ticketShortRef(ticket: { id: string }): string {
  return `T-${ticket.id.slice(0, 8)}`;
}

// ─── Site resolution ──────────────────────────────────────────────────────

function resolveSiteName(inv: Invoice): string {
  if (inv.site?.siteName) return inv.site.siteName;
  if (inv.ticket.site?.siteName) return inv.ticket.site.siteName;
  return "\u2014";
}

// ─── Margin helpers ───────────────────────────────────────────────────────

function lineCostUnit(line: InvoiceLine): number {
  return num(line.ticketLine?.expectedCostUnit);
}

function lineCostTotal(line: InvoiceLine): number {
  const costU = lineCostUnit(line);
  if (costU > 0) return costU * num(line.qty);
  return num(line.ticketLine?.expectedCostTotal);
}

function lineMargin(line: InvoiceLine): number {
  const sell = num(line.lineTotal);
  const cost = lineCostTotal(line);
  return sell - cost;
}

function lineMarginPct(line: InvoiceLine): number {
  const sell = num(line.lineTotal);
  if (sell === 0) return 0;
  return ((sell - lineCostTotal(line)) / sell) * 100;
}

function getReadinessBlockers(inv: Invoice): string[] {
  const blockers: string[] = [];
  if (inv.lines.length === 0) blockers.push("No invoice lines");
  if (inv.ticket?.poRequired && !inv.poNo) blockers.push("Customer requires PO — none linked");
  return blockers;
}

// ─── Tab type ─────────────────────────────────────────────────────────────

type TabKey = "ALL" | "OVERDUE_CHASE";

// ─── Component ────────────────────────────────────────────────────────────

export function InvoicesView({
  invoices,
  customers,
}: {
  invoices: Invoice[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkPoOpen, setLinkPoOpen] = useState(false);
  const [linkPoId, setLinkPoId] = useState("");
  const [poNoInput, setPoNoInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Summary counts
  const drafts = invoices.filter((i) => i.status === "DRAFT");
  const sent = invoices.filter((i) => i.status === "SENT");
  const paid = invoices.filter((i) => i.status === "PAID");
  const outstanding = invoices.filter((i) => i.status !== "PAID" && i.status !== "DRAFT" && i.status !== "CREDITED");

  const draftTotal = drafts.reduce((s, i) => s + num(i.totalSell), 0);
  const sentTotal = sent.reduce((s, i) => s + num(i.totalSell), 0);
  const paidTotal = paid.reduce((s, i) => s + num(i.totalSell), 0);
  const outstandingTotal = outstanding.reduce((s, i) => s + num(i.totalSell), 0);

  // Overdue invoices: SENT or OVERDUE status, with days > 0
  const overdueInvoices = useMemo(() => {
    return invoices
      .filter((inv) => inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID")
      .map((inv) => ({ ...inv, _daysSinceSent: daysSinceSent(inv) }))
      .filter((inv) => inv._daysSinceSent !== null && inv._daysSinceSent > 0)
      .sort((a, b) => (b._daysSinceSent ?? 0) - (a._daysSinceSent ?? 0));
  }, [invoices]);

  // Filtered invoices for main table
  const filtered = useMemo(() => {
    if (activeTab === "OVERDUE_CHASE") return overdueInvoices;
    return invoices.filter((inv) => {
      if (statusFilter !== "ALL" && inv.status !== statusFilter) return false;
      if (customerFilter !== "ALL" && inv.customerId !== customerFilter) return false;
      return true;
    });
  }, [invoices, activeTab, statusFilter, customerFilter, overdueInvoices]);

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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#333333]">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "ALL"
              ? "text-[#FF6600] border-b-2 border-[#FF6600]"
              : "text-[#888888] hover:text-[#CCCCCC]"
          }`}
          onClick={() => setActiveTab("ALL")}
        >
          All Invoices
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ${
            activeTab === "OVERDUE_CHASE"
              ? "text-[#FF6600] border-b-2 border-[#FF6600]"
              : "text-[#888888] hover:text-[#CCCCCC]"
          }`}
          onClick={() => setActiveTab("OVERDUE_CHASE")}
        >
          <Clock className="size-4" />
          Overdue / Chase
          {overdueInvoices.length > 0 && (
            <span className="bg-[#FF4444] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {overdueInvoices.length}
            </span>
          )}
        </button>
      </div>

      {/* Filters (only for ALL tab) */}
      {activeTab === "ALL" && (
        <div className="flex items-center gap-4">
          <div className="w-56">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "ALL")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
                ))}
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
      )}

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
              {activeTab === "OVERDUE_CHASE" && <TableHead>Days Out</TableHead>}
              <TableHead>PO No</TableHead>
              <TableHead className="text-right">Total Sell</TableHead>
              <TableHead>PO Match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeTab === "OVERDUE_CHASE" ? 11 : 10} className="text-center py-8 text-[#888888]">
                  {activeTab === "OVERDUE_CHASE" ? "No overdue invoices." : "No invoices found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => {
                const isExpanded = expandedId === inv.id;
                const allMatched = inv.lines.length > 0 && inv.lines.every((l) => l.poMatched);
                const blockers = inv.status === "DRAFT" ? getReadinessBlockers(inv) : [];
                const days = daysSinceSent(inv);

                // Margin totals for expanded view
                const totalCost = inv.lines.reduce((s, l) => s + lineCostTotal(l), 0);
                const totalSell = num(inv.totalSell);
                const totalMargin = totalSell - totalCost;
                const totalMarginPct = totalSell > 0 ? (totalMargin / totalSell) * 100 : 0;

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
                      <TableCell>
                        <Link
                          href={`/tickets/${inv.ticket.id}`}
                          className="text-[#4488FF] hover:text-[#6699FF] hover:underline transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {ticketShortRef(inv.ticket)}
                        </Link>
                      </TableCell>
                      <TableCell>{inv.customer.name}</TableCell>
                      <TableCell>{resolveSiteName(inv)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{inv.invoiceType.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      {activeTab === "OVERDUE_CHASE" && (
                        <TableCell>
                          {days !== null ? (
                            <span
                              className="font-bold tabular-nums text-sm"
                              style={{ color: overdueColor(days) }}
                            >
                              {days}d
                            </span>
                          ) : (
                            "\u2014"
                          )}
                        </TableCell>
                      )}
                      <TableCell>{inv.poNo || "\u2014"}</TableCell>
                      <TableCell className="text-right tabular-nums">{dec(inv.totalSell)}</TableCell>
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
                        <TableCell colSpan={activeTab === "OVERDUE_CHASE" ? 11 : 10} className="bg-[#1A1A1A] p-4">
                          <div className="space-y-4">
                            {/* Overdue chase info */}
                            {days !== null && days > 0 && (
                              <div
                                className="rounded border p-3 flex items-center justify-between"
                                style={{
                                  borderColor: `${overdueColor(days)}30`,
                                  backgroundColor: `${overdueColor(days)}08`,
                                }}
                              >
                                <div className="flex items-center gap-3">
                                  <Clock className="size-4" style={{ color: overdueColor(days) }} />
                                  <span className="text-sm" style={{ color: overdueColor(days) }}>
                                    {days} days since sent
                                    {inv.issuedAt && (
                                      <span className="text-[#888888] ml-2">
                                        (sent {new Date(inv.issuedAt).toLocaleDateString("en-GB")})
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs"
                                  onClick={(e) => { e.stopPropagation(); }}
                                  disabled
                                >
                                  <Bell className="size-3 mr-1" />
                                  Send Reminder
                                </Button>
                              </div>
                            )}

                            {/* Invoice Lines with Cost/Margin */}
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
                                      <TableHead className="text-right">Cost/Unit</TableHead>
                                      <TableHead className="text-right">Cost Total</TableHead>
                                      <TableHead className="text-right">Margin</TableHead>
                                      <TableHead className="text-right">Margin %</TableHead>
                                      <TableHead>PO Matched</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {inv.lines.length === 0 ? (
                                      <TableRow>
                                        <TableCell colSpan={9} className="text-center py-4 text-[#888888]">
                                          No lines
                                        </TableCell>
                                      </TableRow>
                                    ) : (
                                      <>
                                        {inv.lines.map((line) => {
                                          const costU = lineCostUnit(line);
                                          const costT = lineCostTotal(line);
                                          const margin = lineMargin(line);
                                          const marginP = lineMarginPct(line);

                                          return (
                                            <TableRow key={line.id}>
                                              <TableCell>{line.description}</TableCell>
                                              <TableCell className="text-right tabular-nums">{dec(line.qty)}</TableCell>
                                              <TableCell className="text-right tabular-nums">{dec(line.unitPrice)}</TableCell>
                                              <TableCell className="text-right tabular-nums">{dec(line.lineTotal)}</TableCell>
                                              <TableCell className="text-right tabular-nums text-[#888888]">
                                                {costU > 0 ? dec(costU) : "\u2014"}
                                              </TableCell>
                                              <TableCell className="text-right tabular-nums text-[#888888]">
                                                {costT > 0 ? dec(costT) : "\u2014"}
                                              </TableCell>
                                              <TableCell
                                                className="text-right tabular-nums font-medium"
                                                style={{ color: margin >= 0 ? "#00CC66" : "#FF4444" }}
                                              >
                                                {costT > 0 ? dec(margin) : "\u2014"}
                                              </TableCell>
                                              <TableCell
                                                className="text-right tabular-nums"
                                                style={{ color: marginP >= 0 ? "#00CC66" : "#FF4444" }}
                                              >
                                                {costT > 0 ? pct(marginP) : "\u2014"}
                                              </TableCell>
                                              <TableCell>
                                                {line.poMatched ? (
                                                  <Badge variant="default">Matched</Badge>
                                                ) : (
                                                  <Badge variant="outline">Unmatched</Badge>
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          );
                                        })}
                                        {/* Totals row */}
                                        <TableRow className="border-t-2 border-[#333333] font-bold">
                                          <TableCell>TOTAL</TableCell>
                                          <TableCell />
                                          <TableCell />
                                          <TableCell className="text-right tabular-nums">{dec(totalSell)}</TableCell>
                                          <TableCell />
                                          <TableCell className="text-right tabular-nums text-[#888888]">
                                            {totalCost > 0 ? dec(totalCost) : "\u2014"}
                                          </TableCell>
                                          <TableCell
                                            className="text-right tabular-nums"
                                            style={{ color: totalMargin >= 0 ? "#00CC66" : "#FF4444" }}
                                          >
                                            {totalCost > 0 ? dec(totalMargin) : "\u2014"}
                                          </TableCell>
                                          <TableCell
                                            className="text-right tabular-nums"
                                            style={{ color: totalMarginPct >= 0 ? "#00CC66" : "#FF4444" }}
                                          >
                                            {totalCost > 0 ? pct(totalMarginPct) : "\u2014"}
                                          </TableCell>
                                          <TableCell />
                                        </TableRow>
                                      </>
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
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Ticket link */}
                              <Link
                                href={`/tickets/${inv.ticket.id}`}
                                className="inline-flex items-center gap-1 text-sm text-[#4488FF] hover:text-[#6699FF] hover:underline transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {ticketShortRef(inv.ticket)}
                              </Link>

                              <div className="w-px h-5 bg-[#333333]" />

                              {(inv.status === "DRAFT" || inv.status === "READY_TO_SEND") && (
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
                              {(inv.status === "SENT" || inv.status === "OVERDUE" || inv.status === "PARTIALLY_PAID") && (
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

                              {/* PDF buttons (placeholder) */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => { e.stopPropagation(); }}
                                disabled
                              >
                                <FileText className="size-4 mr-1" />
                                View PDF
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={(e) => { e.stopPropagation(); }}
                                disabled
                              >
                                <Download className="size-4 mr-1" />
                                Download PDF
                              </Button>
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
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  const label = statusLabel(status);
  const variant = statusVariant(status);

  return (
    <Badge
      variant={variant}
      className="text-[10px]"
      style={{
        color,
        borderColor: `${color}40`,
        backgroundColor: variant === "outline" || variant === "secondary" ? `${color}15` : undefined,
      }}
    >
      {label}
    </Badge>
  );
}

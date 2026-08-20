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
  Trash2,
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

function invGross(inv: Invoice): number {
  return num(inv.totalGross) || num(inv.totalSell);
}
function invPaid(inv: Invoice): number {
  return (inv.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
}
// Credit notes applied to this invoice (exclude drafts / voided).
function invCredits(inv: Invoice): number {
  return (inv.salesCreditNotes ?? [])
    .filter((c) => !["DRAFT", "VOID", "VOIDED", "CANCELLED"].includes(c.status))
    .reduce((s, c) => s + num(c.total), 0);
}
// What the customer still owes: gross − payments − applied credit notes.
function invNetDue(inv: Invoice): number {
  return Math.max(invGross(inv) - invPaid(inv) - invCredits(inv), 0);
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
  sourceRef: string | null;
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
  totalNet: Decimal;
  totalVat: Decimal;
  totalGross: Decimal;
  notes: string | null;
  createdAt: string;
  ticket: {
    id: string;
    title: string;
    site: { id: string; siteName: string } | null;
  };
  customer: { id: string; name: string; poRequiredDefault?: boolean; podRequired?: boolean };
  site: { id: string; siteName: string } | null;
  lines: InvoiceLine[];
  poAllocations: { id: string; allocatedValue: Decimal; status: string }[];
  payments: {
    id: string;
    amount: Decimal;
    paymentDate: string;
    paymentMethod: string | null;
    reference: string | null;
    notes: string | null;
  }[];
  salesCreditNotes: {
    id: string;
    creditNoteNo: string | null;
    total: Decimal;
    status: string;
  }[];
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

/** Sum of every supplier-bill cost actually allocated to this ticket line. */
function lineActualBillCost(line: InvoiceLine): number {
  const allocs = (line.ticketLine as unknown as { costAllocations?: Array<{ totalCost: unknown }> })?.costAllocations ?? [];
  return allocs.reduce((s, a) => s + num(a.totalCost), 0);
}

function lineCostUnit(line: InvoiceLine): number {
  // Prefer actual cost from supplier bills if present; fall back to expected
  const actualTotal = lineActualBillCost(line);
  if (actualTotal > 0) {
    const qty = num(line.qty);
    return qty > 0 ? actualTotal / qty : 0;
  }
  return num(line.ticketLine?.expectedCostUnit);
}

function lineCostTotal(line: InvoiceLine): number {
  const actualTotal = lineActualBillCost(line);
  if (actualTotal > 0) return actualTotal;
  const costU = num(line.ticketLine?.expectedCostUnit);
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

  const [payOpen, setPayOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payMethod, setPayMethod] = useState("");
  const [payReference, setPayReference] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [payError, setPayError] = useState<string | null>(null);

  // Summary counts
  const drafts = invoices.filter((i) => i.status === "DRAFT");
  const sent = invoices.filter((i) => i.status === "SENT");
  const paid = invoices.filter((i) => i.status === "PAID");
  const outstanding = invoices.filter((i) => i.status !== "PAID" && i.status !== "DRAFT" && i.status !== "CREDITED");

  const grossOf = (i: Invoice) => num(i.totalGross) || num(i.totalSell);
  const draftTotal = drafts.reduce((s, i) => s + grossOf(i), 0);
  const sentTotal = sent.reduce((s, i) => s + grossOf(i), 0);
  const paidTotal = paid.reduce((s, i) => s + grossOf(i), 0);
  const outstandingTotal = outstanding.reduce((s, i) => s + invNetDue(i), 0);

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
      let res = await fetch(`/api/sales-invoices/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      // 412 = gate blocked. Show what's missing and offer override.
      if (res.status === 412) {
        const j = await res.json();
        const missingMsg = Array.isArray(j.missing) ? j.missing.join("\n• ") : (j.message ?? "missing evidence");
        const reason = window.prompt(
          `Cannot send — missing required evidence:\n\n• ${missingMsg}\n\n` +
          `Type a reason to OVERRIDE and send anyway, or Cancel to fix the evidence first.`,
        );
        if (!reason || !reason.trim()) return;
        res = await fetch(`/api/sales-invoices/${id}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrideGate: true, overrideReason: reason.trim() }),
        });
      }

      if (res.ok) router.refresh();
      else {
        const j = await res.json().catch(() => ({}));
        alert(`Send failed: ${j.message ?? j.error ?? `HTTP ${res.status}`}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBundle(id: string) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sales-invoices/${id}/bundled-pdf`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Bundle failed: ${j.error ?? `HTTP ${res.status}`}`);
        return;
      }
      if (j.path) window.open(j.path, "_blank");
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

  function openRecordPayment(inv: Invoice) {
    const outstanding = invNetDue(inv);
    setPayInvoice(inv);
    setPayAmount(outstanding > 0 ? outstanding.toFixed(2) : "");
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod("");
    setPayReference("");
    setPayNotes("");
    setPayError(null);
    setPayOpen(true);
  }

  async function handleRecordPayment() {
    if (!payInvoice) return;
    const amt = Number(payAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setPayError("Enter a positive amount");
      return;
    }
    if (!payDate) {
      setPayError("Enter a payment date");
      return;
    }
    setSubmitting(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          salesInvoiceId: payInvoice.id,
          amount: amt,
          paymentDate: new Date(payDate).toISOString(),
          paymentMethod: payMethod.trim() || null,
          reference: payReference.trim() || null,
          notes: payNotes.trim() || null,
        }),
      });
      if (res.ok) {
        setPayOpen(false);
        router.refresh();
      } else {
        const err = await res.json().catch(() => null);
        setPayError(err?.error || "Failed to record payment");
      }
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
              <TableHead className="text-right">Gross Total</TableHead>
              <TableHead>PO Match</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={activeTab === "OVERDUE_CHASE" ? 12 : 11} className="text-center py-8 text-[#888888]">
                  {activeTab === "OVERDUE_CHASE" ? "No overdue invoices." : "No invoices found."}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => {
                const isExpanded = expandedId === inv.id;
                const headerMatched = (inv.notes || "").includes("[PO_MATCHED_HEADER]");
                const allMatched =
                  (inv.lines.length > 0 && inv.lines.every((l) => l.poMatched)) ||
                  (inv.lines.length === 0 && !!inv.poNo && headerMatched);
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
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>{inv.customer.name}</span>
                          {inv.customer.poRequiredDefault && (
                            <Badge className="text-[8px] px-1 py-0 text-[#FF9900] bg-[#FF9900]/10" title="Customer requires a PO number on the invoice">PO</Badge>
                          )}
                          {inv.customer.podRequired && (
                            <Badge className="text-[8px] px-1 py-0 text-[#3399FF] bg-[#3399FF]/10" title="Customer requires Proof of Delivery before send">POD</Badge>
                          )}
                        </div>
                      </TableCell>
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
                      <TableCell className="text-right tabular-nums">{dec(grossOf(inv))}</TableCell>
                      <TableCell>
                        {allMatched ? (
                          <Check className="size-4 text-[#00CC66]" />
                        ) : (
                          <AlertTriangle className="size-4 text-[#FF9900]" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {(inv.salesCreditNotes ?? []).length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-1.5 text-[10px] text-[#00CC66] border-[#333333] hover:bg-[#00CC66]/10"
                              title={`Credit note PDF (${(inv.salesCreditNotes ?? []).map((c) => c.creditNoteNo).filter(Boolean).join(", ")})`}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const cns = inv.salesCreditNotes ?? [];
                                if (cns.length !== 1) {
                                  setExpandedId(inv.id);
                                  return;
                                }
                                const res = await fetch(`/api/sales-credit-notes/${cns[0].id}/generate-pdf`, { method: "POST" });
                                const json = await res.json().catch(() => null);
                                if (res.ok && json?.path) {
                                  window.open(json.path, "_blank");
                                } else {
                                  alert(json?.error || "Failed to generate credit note PDF");
                                }
                              }}
                            >
                              <Download className="size-3 mr-0.5" />
                              CN
                            </Button>
                          )}
                          {(inv.status === "DRAFT" || inv.status === "VOIDED") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 w-6 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/30 border-[#333333]"
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!confirm(`Delete ${inv.invoiceNo || "this draft invoice"}?`)) return;
                                const res = await fetch(`/api/sales-invoices/${inv.id}`, { method: "DELETE" });
                                if (res.ok) {
                                  router.refresh();
                                } else {
                                  const err = await res.json().catch(() => null);
                                  alert(err?.error || "Failed to delete");
                                }
                              }}
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={activeTab === "OVERDUE_CHASE" ? 12 : 11} className="bg-[#1A1A1A] p-4">
                          <div className="space-y-4">
                            {/* Editable invoice details (date, PO, notes) */}
                            <InvoiceDetailsControl invoice={inv} />
                            {/* Billing entity swap (group sister entities only) */}
                            <ChangeEntityControl
                              invoiceId={inv.id}
                              currentName={inv.customer.name}
                              currentCustomerId={inv.customerId}
                              status={inv.status}
                              customers={customers}
                            />
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
                                      <TableHead>Cost From</TableHead>
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
                                              <TableCell>
                                                {line.description}
                                                {line.sourceRef && (
                                                  <div className="text-xs text-[#888888] mt-0.5">Quote {line.sourceRef}</div>
                                                )}
                                              </TableCell>
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
                                              <TableCell className="text-xs">
                                                {(() => {
                                                  const allocs = (line.ticketLine as unknown as { costAllocations?: Array<{ totalCost: unknown; supplierBillLine?: { supplierBill: { id: string; billNo: string; supplier: { name: string } } } | null }> })?.costAllocations ?? [];
                                                  if (allocs.length === 0) return <span className="text-muted-foreground">—</span>;
                                                  return (
                                                    <div className="space-y-0.5">
                                                      {allocs.map((a, i) => {
                                                        const bill = a.supplierBillLine?.supplierBill;
                                                        return (
                                                          <div key={i}>
                                                            {bill ? (
                                                              <a href={`/procurement?bill=${bill.id}`} className="text-primary hover:underline">
                                                                {bill.supplier.name} {bill.billNo}
                                                              </a>
                                                            ) : (
                                                              <span className="text-muted-foreground">PO (no bill yet)</span>
                                                            )}
                                                            <span className="text-muted-foreground"> £{num(a.totalCost).toFixed(2)}</span>
                                                          </div>
                                                        );
                                                      })}
                                                    </div>
                                                  );
                                                })()}
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
                                          <TableCell />
                                        </TableRow>
                                      </>
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>

                            {/* Invoice totals (net / VAT / gross) */}
                            {(() => {
                              const net = num(inv.totalNet);
                              const vat = num(inv.totalVat);
                              const gross = num(inv.totalGross) || num(inv.totalSell);
                              const VAT_FIXABLE = new Set(["DRAFT", "SENT", "OVERDUE", "PARTIALLY_PAID"]);
                              const canApplyVat = VAT_FIXABLE.has(inv.status) && vat === 0 && (net > 0 || num(inv.totalSell) > 0);
                              return (
                                <div className="flex items-center gap-6 text-sm bg-[#0F0F0F] border border-[#333333] rounded p-3">
                                  <div>
                                    <span className="text-[#888888]">Net</span>{" "}
                                    <span className="tabular-nums">{dec(net)}</span>
                                  </div>
                                  <div>
                                    <span className="text-[#888888]">VAT</span>{" "}
                                    <span className="tabular-nums">{dec(vat)}</span>
                                  </div>
                                  <div>
                                    <span className="text-[#888888]">Gross</span>{" "}
                                    <span className="tabular-nums font-medium text-[#CCCCCC]">
                                      {dec(gross)}
                                    </span>
                                  </div>
                                  {invCredits(inv) > 0 && (
                                    <>
                                      <div>
                                        <span className="text-[#888888]">Credits</span>{" "}
                                        <span className="tabular-nums text-[#00CC66]">
                                          -{dec(invCredits(inv))}
                                        </span>
                                      </div>
                                      <div>
                                        <span className="text-[#888888]">Balance Due</span>{" "}
                                        <span className="tabular-nums font-bold text-[#FF9900]">
                                          {dec(invNetDue(inv))}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                  {canApplyVat && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="ml-auto"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const sentMsg = inv.status === "DRAFT"
                                          ? "Apply standard 20% VAT to every line on this draft?"
                                          : "This invoice has been sent. Applying VAT will reverse the existing GL entry and post a new one with VAT. Continue?";
                                        if (!confirm(sentMsg)) return;
                                        const res = await fetch(`/api/sales-invoices/${inv.id}/apply-vat`, { method: "POST" });
                                        if (res.ok) router.refresh();
                                        else {
                                          const err = await res.json().catch(() => null);
                                          alert(err?.error || "Failed to apply VAT");
                                        }
                                      }}
                                    >
                                      Apply 20% VAT
                                    </Button>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Credit Notes */}
                            {(inv.salesCreditNotes ?? []).length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium mb-2">Credit Notes</h4>
                                <div className="border border-[#333333] bg-[#1A1A1A] divide-y divide-[#2A2A2A]">
                                  {(inv.salesCreditNotes ?? []).map((cn) => (
                                    <div key={cn.id} className="flex items-center justify-between px-3 py-2 text-sm">
                                      <div className="flex items-center gap-3">
                                        <span className="font-medium text-[#E0E0E0]">{cn.creditNoteNo || "—"}</span>
                                        <Badge variant="outline" className="text-[9px]">{cn.status}</Badge>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <span className="tabular-nums text-[#00CC66]">-{dec(cn.total)}</span>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 text-[10px]"
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const res = await fetch(`/api/sales-credit-notes/${cn.id}/generate-pdf`, { method: "POST" });
                                            const json = await res.json().catch(() => null);
                                            if (res.ok && json?.path) {
                                              window.open(json.path, "_blank");
                                            } else {
                                              alert(json?.error || "Failed to generate credit note PDF");
                                            }
                                          }}
                                        >
                                          <Download className="size-3 mr-1" />
                                          PDF
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Payments */}
                            {(inv.payments ?? []).length > 0 && (() => {
                              const paid = (inv.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
                              const outstanding = invNetDue(inv);
                              return (
                                <div>
                                  <h4 className="text-sm font-medium mb-2">Payments</h4>
                                  <div className="border border-[#333333] bg-[#1A1A1A]">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Date</TableHead>
                                          <TableHead>Method</TableHead>
                                          <TableHead>Reference</TableHead>
                                          <TableHead>Notes</TableHead>
                                          <TableHead className="text-right">Amount</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {(inv.payments ?? []).map((p) => (
                                          <TableRow key={p.id}>
                                            <TableCell>{new Date(p.paymentDate).toLocaleDateString("en-GB")}</TableCell>
                                            <TableCell>{p.paymentMethod || "—"}</TableCell>
                                            <TableCell>{p.reference || "—"}</TableCell>
                                            <TableCell className="text-[#888888]">{p.notes || "—"}</TableCell>
                                            <TableCell className="text-right tabular-nums">{dec(p.amount)}</TableCell>
                                          </TableRow>
                                        ))}
                                        <TableRow className="border-t-2 border-[#333333] font-bold">
                                          <TableCell colSpan={4}>Paid to date</TableCell>
                                          <TableCell className="text-right tabular-nums">{dec(paid)}</TableCell>
                                        </TableRow>
                                        <TableRow className="font-bold">
                                          <TableCell colSpan={4}>Outstanding</TableCell>
                                          <TableCell
                                            className="text-right tabular-nums"
                                            style={{ color: outstanding > 0 ? "#FF9900" : "#00CC66" }}
                                          >
                                            {dec(outstanding)}
                                          </TableCell>
                                        </TableRow>
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              );
                            })()}

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
                                onClick={(e) => { e.stopPropagation(); handleBundle(inv.id); }}
                                disabled={submitting}
                                title="Generate one PDF combining customer PO + invoice + all PODs"
                              >
                                <FileText className="size-4 mr-1" />
                                Bundle
                              </Button>
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
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => { e.stopPropagation(); openRecordPayment(inv); }}
                                    disabled={submitting}
                                  >
                                    <CreditCard className="size-4 mr-1" />
                                    Record Payment
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(e) => { e.stopPropagation(); handleMarkPaid(inv.id); }}
                                    disabled={submitting}
                                  >
                                    <Check className="size-4 mr-1" />
                                    Mark Paid
                                  </Button>
                                </>
                              )}

                              {/* PDF buttons */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const res = await fetch(`/api/sales-invoices/${inv.id}/generate-pdf`, { method: "POST" });
                                  if (res.ok) {
                                    window.open(`/api/sales-invoices/${inv.id}/generate-pdf`, "_blank");
                                  } else {
                                    const err = await res.json().catch(() => null);
                                    alert(err?.error || "PDF generation failed");
                                  }
                                }}
                              >
                                <Download className="size-4 mr-1" />
                                Generate PDF
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

      {/* Record Payment Dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Record Payment {payInvoice?.invoiceNo ? `· ${payInvoice.invoiceNo}` : ""}
            </DialogTitle>
          </DialogHeader>
          {payInvoice && (() => {
            const paid = (payInvoice.payments ?? []).reduce((s, p) => s + num(p.amount), 0);
            const net = num(payInvoice.totalNet);
            const vat = num(payInvoice.totalVat);
            const gross = num(payInvoice.totalGross) || num(payInvoice.totalSell);
            const credits = invCredits(payInvoice);
            const outstanding = invNetDue(payInvoice);
            return (
              <div className="text-xs text-[#888888] -mt-2 mb-2 space-y-0.5">
                <div>
                  Net {dec(net)} · VAT {dec(vat)} · Gross{" "}
                  <span className="text-[#CCCCCC] font-medium">{dec(gross)}</span>
                </div>
                <div>
                  Paid {dec(paid)}
                  {credits > 0 ? ` · Credits -${dec(credits)}` : ""} · Outstanding{" "}
                  <span style={{ color: outstanding > 0 ? "#FF9900" : "#00CC66" }}>
                    {dec(outstanding)}
                  </span>
                </div>
              </div>
            );
          })()}
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount"
                type="number"
                step="0.01"
                min="0"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="pay-date">Payment Date</Label>
              <Input
                id="pay-date"
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="pay-method">Method</Label>
              <Input
                id="pay-method"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
                placeholder="Bank transfer, card, cash..."
              />
            </div>
            <div>
              <Label htmlFor="pay-ref">Reference</Label>
              <Input
                id="pay-ref"
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
                placeholder="Bank ref / cheque no."
              />
            </div>
            <div>
              <Label htmlFor="pay-notes">Notes</Label>
              <Input
                id="pay-notes"
                value={payNotes}
                onChange={(e) => setPayNotes(e.target.value)}
              />
            </div>
            {payError && (
              <p className="text-sm text-[#FF4444]">{payError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleRecordPayment} disabled={submitting || !payAmount}>
              {submitting ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

// ─── Change billing entity (within a corporate group) ────────────────────
function InvoiceDetailsControl({ invoice }: { invoice: Invoice }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuedAt, setIssuedAt] = useState(
    invoice.issuedAt ? invoice.issuedAt.slice(0, 10) : ""
  );
  const [poNo, setPoNo] = useState(invoice.poNo ?? "");
  const [notes, setNotes] = useState(invoice.notes ?? "");

  const isPosted = invoice.status !== "DRAFT" && invoice.status !== "VOIDED";

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales-invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuedAt: issuedAt ? new Date(issuedAt).toISOString() : null,
          poNo: poNo || null,
          notes: notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-[#333333] bg-[#1F1F1F] p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs flex items-center gap-4 flex-wrap">
          <span>
            <span className="text-[#888888]">Invoice date: </span>
            <span className="font-medium text-[#E0E0E0]">
              {invoice.issuedAt
                ? new Date(invoice.issuedAt).toLocaleDateString("en-GB")
                : "—"}
            </span>
          </span>
          <span>
            <span className="text-[#888888]">PO: </span>
            <span className="font-medium text-[#E0E0E0]">{invoice.poNo || "—"}</span>
          </span>
        </div>
        {!editing && (
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-6"
            onClick={() => setEditing(true)}
          >
            Edit Details
          </Button>
        )}
      </div>

      {editing && (
        <div className="space-y-2 pt-1">
          {isPosted && (
            <div className="text-[10px] text-[#FFAA00]">
              This invoice is {statusLabel(invoice.status).toLowerCase()}. Changing the date
              will re-date its posted ledger entry into the matching period.
            </div>
          )}
          <div className="flex items-end gap-2 flex-wrap">
            <label className="text-[10px] text-[#888888] flex flex-col gap-1">
              Invoice date
              <Input
                type="date"
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
                className="h-7 text-xs w-[150px]"
              />
            </label>
            <label className="text-[10px] text-[#888888] flex flex-col gap-1">
              PO number
              <Input
                type="text"
                value={poNo}
                onChange={(e) => setPoNo(e.target.value)}
                placeholder="PO number"
                className="h-7 text-xs w-[180px]"
              />
            </label>
          </div>
          <label className="text-[10px] text-[#888888] flex flex-col gap-1">
            Notes
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              className="h-7 text-xs w-full max-w-[420px]"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-[10px] bg-[#FF6600] text-black hover:bg-[#FF6600]/90"
              disabled={busy}
              onClick={save}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setError(null);
                setIssuedAt(invoice.issuedAt ? invoice.issuedAt.slice(0, 10) : "");
                setPoNo(invoice.poNo ?? "");
                setNotes(invoice.notes ?? "");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <div className="text-[11px] text-[#FF6666]">{error}</div>}
    </div>
  );
}

function ChangeEntityControl({
  invoiceId,
  currentName,
  currentCustomerId,
  status,
  customers,
}: {
  invoiceId: string;
  currentName: string;
  currentCustomerId: string;
  status: string;
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const isPaid = status === "PAID";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => c.id !== currentCustomerId)
      .filter((c) => (q ? c.name.toLowerCase().includes(q) : true))
      .slice(0, 50);
  }, [customers, currentCustomerId, query]);

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sales-invoices/${invoiceId}/change-entity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: target, reason: reason || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-[#333333] bg-[#1F1F1F] p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-xs">
          <span className="text-[#888888]">Billing customer: </span>
          <span className="font-medium text-[#E0E0E0]">{currentName}</span>
        </div>
        {!open ? (
          <Button
            size="sm"
            variant="outline"
            className="text-[10px] h-6"
            onClick={() => setOpen(true)}
          >
            Change Customer
          </Button>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customer…"
              className="h-7 text-xs w-[180px]"
            />
            <Select value={target} onValueChange={(v) => setTarget(v ?? "")}>
              <SelectTrigger className="h-7 text-xs min-w-[220px]">
                <SelectValue placeholder="— pick customer —" />
              </SelectTrigger>
              <SelectContent>
                {matches.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-[#888888]">No matches</div>
                ) : (
                  matches.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="h-7 text-xs min-w-[180px]"
            />
            <Button
              size="sm"
              className="h-7 text-[10px] bg-[#FF6600] text-black hover:bg-[#FF6600]/90"
              disabled={!target || busy}
              onClick={submit}
            >
              {busy ? "Switching…" : "Switch"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setTarget("");
                setQuery("");
                setReason("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
      {open && isPaid && (
        <div className="text-[10px] text-[#FFAA00]">
          Invoice is PAID — the payment on record will also move to the new customer.
        </div>
      )}
      {error && (
        <div className="text-[11px] text-[#FF6666]">{error}</div>
      )}
    </div>
  );
}

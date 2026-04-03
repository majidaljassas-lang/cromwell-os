"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, AlertTriangle, Send, Link2, CreditCard, ChevronDown, ChevronRight } from "lucide-react";
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

export function InvoicesView({
  invoices,
  customers,
}: {
  invoices: Invoice[];
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [linkPoOpen, setLinkPoOpen] = useState(false);
  const [linkPoId, setLinkPoId] = useState("");
  const [poNoInput, setPoNoInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
            <p className="text-sm text-muted-foreground">Drafts</p>
            <p className="text-2xl font-bold">{drafts.length}</p>
            <p className="text-sm text-muted-foreground">{dec(draftTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Sent</p>
            <p className="text-2xl font-bold">{sent.length}</p>
            <p className="text-sm text-muted-foreground">{dec(sentTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Paid</p>
            <p className="text-2xl font-bold">{paid.length}</p>
            <p className="text-sm text-muted-foreground">{dec(paidTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-muted-foreground">Total Outstanding</p>
            <p className="text-2xl font-bold text-orange-600">{dec(outstandingTotal)}</p>
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
      <div className="rounded-lg border bg-background">
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
              <TableHead>Issued</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>PO Match</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                  No invoices found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((inv) => {
                const isExpanded = expandedId === inv.id;
                const allMatched = inv.lines.length > 0 && inv.lines.every((l) => l.poMatched);
                const blockers = inv.status === "DRAFT" ? getReadinessBlockers(inv) : [];

                return (
                  <Fragment key={inv.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
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
                      <TableCell className="text-muted-foreground">
                        {inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : "\u2014"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : "\u2014"}
                      </TableCell>
                      <TableCell>
                        {allMatched ? (
                          <Check className="size-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="size-4 text-amber-500" />
                        )}
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={12} className="bg-muted/30 p-4">
                          <div className="space-y-4">
                            {/* Invoice Lines */}
                            <div>
                              <h4 className="text-sm font-medium mb-2">Invoice Lines</h4>
                              <div className="rounded border bg-background">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Description</TableHead>
                                      <TableHead className="text-right">Qty</TableHead>
                                      <TableHead className="text-right">Unit Price</TableHead>
                                      <TableHead className="text-right">Line Total</TableHead>
                                      <TableHead>PO Matched</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {inv.lines.length === 0 ? (
                                      <TableRow>
                                        <TableCell colSpan={5} className="text-center py-4 text-muted-foreground">
                                          No lines
                                        </TableCell>
                                      </TableRow>
                                    ) : (
                                      inv.lines.map((line) => (
                                        <TableRow key={line.id}>
                                          <TableCell>{line.description}</TableCell>
                                          <TableCell className="text-right tabular-nums">{dec(line.qty)}</TableCell>
                                          <TableCell className="text-right tabular-nums">{dec(line.unitPrice)}</TableCell>
                                          <TableCell className="text-right tabular-nums">{dec(line.lineTotal)}</TableCell>
                                          <TableCell>
                                            {line.poMatched ? (
                                              <Badge variant="default">Matched</Badge>
                                            ) : (
                                              <Badge variant="outline">Unmatched</Badge>
                                            )}
                                          </TableCell>
                                        </TableRow>
                                      ))
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>

                            {/* Readiness warnings */}
                            {blockers.length > 0 && (
                              <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3">
                                <h4 className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-1">
                                  Invoice Readiness Blockers
                                </h4>
                                <ul className="text-sm text-amber-600 dark:text-amber-300 list-disc pl-4 space-y-0.5">
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


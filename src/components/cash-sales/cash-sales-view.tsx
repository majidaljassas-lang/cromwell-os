"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
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
  TableFooter,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type Decimal = { toString(): string } | string | number | null;

function money(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return `\u00A3${Number(val || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function num(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

type TicketLine = {
  id: string;
  description: string;
  qty: Decimal;
  unit: string;
  expectedCostUnit: Decimal;
  expectedCostTotal: Decimal;
  actualCostTotal: Decimal;
  actualSaleUnit: Decimal;
  actualSaleTotal: Decimal;
  lineType: string;
  supplierName: string | null;
};

type CashSale = {
  id: string;
  ticketId: string;
  receivedAmount: Decimal;
  receivedAt: string;
  paymentMethod: string;
  receiptRef: string | null;
  status: string;
  ticket: {
    id: string;
    title: string;
    payingCustomer: { id: string; name: string } | null;
    lines: TicketLine[];
  };
};

type Ticket = {
  id: string;
  title: string;
};

function statusBadge(status: string) {
  switch (status) {
    case "RECEIVED":
      return (
        <Badge className="bg-[#00CC66]/10 text-[#00CC66]">
          {status}
        </Badge>
      );
    case "PENDING":
      return (
        <Badge className="bg-[#FF9900]/10 text-[#FF9900]">
          {status}
        </Badge>
      );
    case "REFUNDED":
      return (
        <Badge className="bg-[#FF3333]/10 text-[#FF3333]">
          {status}
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function profitColor(profit: number): string {
  if (profit > 0) return "text-[#00CC66]";
  if (profit < 0) return "text-[#FF3333]";
  return "text-[#888888]";
}

export function CashSalesView({
  cashSales,
  tickets,
}: {
  cashSales: CashSale[];
  tickets: Ticket[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [expandedSale, setExpandedSale] = useState<string | null>(null);

  const [ticketId, setTicketId] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [paymentMethod, setPaymentMethod] = useState("BANK_TRANSFER");
  const [receiptRef, setReceiptRef] = useState("");
  const [status, setStatus] = useState("RECEIVED");

  const totalAll = cashSales.reduce((s, cs) => s + num(cs.receivedAmount), 0);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonth = cashSales.filter(
    (cs) => new Date(cs.receivedAt) >= startOfMonth
  );
  const totalThisMonth = thisMonth.reduce(
    (s, cs) => s + num(cs.receivedAmount),
    0
  );

  // Calculate total cost across all cash sales
  const totalCost = cashSales.reduce((s, cs) => {
    return s + cs.ticket.lines.reduce((ls, l) => ls + num(l.actualCostTotal ?? l.expectedCostTotal), 0);
  }, 0);
  const totalProfit = totalAll - totalCost;

  async function handleSubmit() {
    if (!ticketId || !receivedAmount) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/cash-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          receivedAmount: parseFloat(receivedAmount),
          receivedAt: new Date(receivedAt).toISOString(),
          paymentMethod,
          receiptRef: receiptRef || null,
          status,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setTicketId("");
        setReceivedAmount("");
        setReceiptRef("");
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
            <p className="text-sm text-[#888888]">Total Cash Received</p>
            <p className="text-2xl font-bold">{money(totalAll)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">This Month</p>
            <p className="text-2xl font-bold">{money(totalThisMonth)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Total Profit</p>
            <p className={`text-2xl font-bold ${profitColor(totalProfit)}`}>{money(totalProfit)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Count</p>
            <p className="text-2xl font-bold">{cashSales.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* VAT Note */}
      <div className="flex items-start gap-2 px-3 py-2 border border-[#333333] bg-[#1A1A1A] text-sm text-[#888888]">
        <AlertTriangle className="size-4 text-[#FF9900] shrink-0 mt-0.5" />
        <span>
          Bill VAT on supplier costs is reclaimable. Cash sale income is off-books and not invoiced through the standard sales ledger.
        </span>
      </div>

      {/* Actions */}
      <div className="flex justify-end">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button>
                <Plus className="size-4 mr-1" />
                Add Cash Sale
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Cash Sale</SheetTitle>
              <SheetDescription>
                Record a new cash sale payment.
              </SheetDescription>
            </SheetHeader>
            <div className="p-4 space-y-4">
              <div className="space-y-2">
                <Label>Ticket</Label>
                <Select
                  value={ticketId}
                  onValueChange={(v) => setTicketId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select ticket" />
                  </SelectTrigger>
                  <SelectContent>
                    {tickets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Received Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={receivedAmount}
                  onChange={(e) => setReceivedAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>Received At</Label>
                <Input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) =>
                    setPaymentMethod(v ?? "BANK_TRANSFER")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="BANK_TRANSFER">Bank Transfer</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Receipt Ref</Label>
                <Input
                  value={receiptRef}
                  onChange={(e) => setReceiptRef(e.target.value)}
                  placeholder="Optional reference"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v ?? "RECEIVED")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RECEIVED">Received</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="REFUNDED">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={submitting || !ticketId || !receivedAmount}
              >
                {submitting ? "Saving..." : "Save Cash Sale"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Table with expandable line items */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Ticket</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Cash Received</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashSales.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center py-8 text-[#888888]"
                >
                  No cash sales recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              cashSales.map((cs) => {
                const isExpanded = expandedSale === cs.id;
                const lineCost = cs.ticket.lines.reduce(
                  (s, l) => s + num(l.actualCostTotal ?? l.expectedCostTotal),
                  0
                );
                const received = num(cs.receivedAmount);
                const profit = received - lineCost;

                return (
                  <Fragment key={cs.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-[#222222]"
                      onClick={() => setExpandedSale(isExpanded ? null : cs.id)}
                    >
                      <TableCell>
                        {cs.ticket.lines.length > 0 ? (
                          isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )
                        ) : null}
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">
                        {cs.ticket.title}
                      </TableCell>
                      <TableCell className="text-[#888888]">
                        {cs.ticket.payingCustomer?.name ?? "\u2014"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {lineCost > 0 ? money(lineCost) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {money(cs.receivedAmount)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-medium ${profitColor(profit)}`}>
                        {lineCost > 0 ? money(profit) : "\u2014"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {cs.paymentMethod.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[#888888] tabular-nums">
                        {new Date(cs.receivedAt).toLocaleDateString("en-GB")}
                      </TableCell>
                      <TableCell>{statusBadge(cs.status)}</TableCell>
                    </TableRow>

                    {/* Expanded line items */}
                    {isExpanded && cs.ticket.lines.length > 0 && (
                      <>
                        <TableRow className="bg-[#111111]">
                          <TableCell />
                          <TableCell colSpan={2} className="text-xs font-bold text-[#888888] uppercase tracking-wider">
                            Line Item
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-[#888888] uppercase tracking-wider">
                            Cost/Unit
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-[#888888] uppercase tracking-wider">
                            Qty
                          </TableCell>
                          <TableCell className="text-right text-xs font-bold text-[#888888] uppercase tracking-wider">
                            Total Cost
                          </TableCell>
                          <TableCell colSpan={2} className="text-xs font-bold text-[#888888] uppercase tracking-wider">
                            Supplier
                          </TableCell>
                          <TableCell />
                        </TableRow>
                        {cs.ticket.lines.map((line) => {
                          const costUnit = num(line.expectedCostUnit);
                          const costTotal = num(line.actualCostTotal ?? line.expectedCostTotal);
                          return (
                            <TableRow key={line.id} className="bg-[#111111] border-t border-[#222222]">
                              <TableCell />
                              <TableCell colSpan={2} className="text-sm text-[#CCCCCC] pl-6">
                                {line.description}
                                <Badge variant="outline" className="ml-2 text-[10px]">
                                  {line.lineType}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                {costUnit > 0 ? money(costUnit) : "\u2014"}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                {num(line.qty)} {line.unit}
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-sm font-medium">
                                {costTotal > 0 ? money(costTotal) : "\u2014"}
                              </TableCell>
                              <TableCell colSpan={2} className="text-sm text-[#888888]">
                                {line.supplierName || "\u2014"}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          );
                        })}
                        {/* Line items summary row */}
                        <TableRow className="bg-[#111111] border-t border-[#333333]">
                          <TableCell />
                          <TableCell colSpan={4} className="text-sm font-bold text-[#CCCCCC] text-right">
                            Total Cost / Cash / Profit:
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-bold">
                            {money(lineCost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm font-bold">
                            {money(received)}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums text-sm font-bold ${profitColor(profit)}`}>
                            {money(profit)}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      </>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
          {cashSales.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell />
                <TableCell className="font-bold" colSpan={2}>Totals</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{money(totalCost)}</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{money(totalAll)}</TableCell>
                <TableCell className={`text-right tabular-nums font-bold ${profitColor(totalProfit)}`}>
                  {money(totalProfit)}
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}

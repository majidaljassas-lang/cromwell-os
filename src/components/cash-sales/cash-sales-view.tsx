"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-[#888888]">Total Cash Sales</p>
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
            <p className="text-sm text-[#888888]">Count</p>
            <p className="text-2xl font-bold">{cashSales.length}</p>
          </CardContent>
        </Card>
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

      {/* Table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Received Amount</TableHead>
              <TableHead>Payment Method</TableHead>
              <TableHead>Receipt Ref</TableHead>
              <TableHead>Received At</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashSales.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center py-8 text-[#888888]"
                >
                  No cash sales recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              cashSales.map((cs) => (
                <TableRow key={cs.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {cs.ticket.title}
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {cs.ticket.payingCustomer?.name ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {money(cs.receivedAmount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {cs.paymentMethod.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[#888888]">
                    {cs.receiptRef || "\u2014"}
                  </TableCell>
                  <TableCell className="text-[#888888] tabular-nums">
                    {new Date(cs.receivedAt).toLocaleDateString("en-GB")}
                  </TableCell>
                  <TableCell>{statusBadge(cs.status)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, ChevronRight, Send, CheckCircle } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type QuoteLine = {
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
  lines: QuoteLine[];
};

type CustomerData = { id: string; name: string };

interface QuotePanelProps {
  ticketId: string;
  quotes: QuoteData[];
  customers: CustomerData[];
}

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "APPROVED":
      return "default";
    case "SENT":
      return "secondary";
    case "DRAFT":
      return "outline";
    case "REJECTED":
      return "destructive";
    default:
      return "outline";
  }
}

export function QuotePanel({ ticketId, quotes, customers }: QuotePanelProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/quotes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteType: (fd.get("quoteType") as string) || "STANDARD",
          customerId: selectedCustomerId,
          notes: (fd.get("notes") as string) || undefined,
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        setSelectedCustomerId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(quoteId: string, status: string) {
    const body: Record<string, unknown> = { status };
    if (status === "SENT") body.issuedAt = new Date().toISOString();
    await fetch(`/api/tickets/${ticketId}/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Quotes</h2>
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Generate Quote
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Generate Quote</SheetTitle>
              <SheetDescription>
                Create a new quote for this ticket.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleCreate}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="quoteType">Quote Type</Label>
                <Input
                  id="quoteType"
                  name="quoteType"
                  defaultValue="STANDARD"
                  placeholder="STANDARD"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select
                  value={selectedCustomerId}
                  onValueChange={(v) => setSelectedCustomerId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-notes">Notes</Label>
                <Textarea
                  id="q-notes"
                  name="notes"
                  placeholder="Optional"
                  rows={3}
                />
              </div>
              <SheetFooter>
                <Button
                  type="submit"
                  disabled={submitting || !selectedCustomerId}
                >
                  {submitting ? "Creating..." : "Generate Quote"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {quotes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No quotes generated yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {quotes.map((quote) => {
            const isExpanded = expandedId === quote.id;
            return (
              <Card key={quote.id}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() =>
                        setExpandedId(isExpanded ? null : quote.id)
                      }
                      className="flex items-center gap-2 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                      <span className="font-medium text-sm">
                        {quote.quoteNo}
                      </span>
                      <Badge variant="secondary">v{quote.versionNo}</Badge>
                      <Badge variant="outline">{quote.quoteType}</Badge>
                      <Badge variant={statusVariant(quote.status)}>
                        {quote.status}
                      </Badge>
                    </button>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-muted-foreground">
                        {quote.customer.name}
                      </span>
                      <span className="text-sm font-medium tabular-nums">
                        {dec(quote.totalSell)}
                      </span>
                      {quote.issuedAt && (
                        <span className="text-xs text-muted-foreground">
                          Issued:{" "}
                          {new Date(quote.issuedAt).toLocaleDateString()}
                        </span>
                      )}
                      <div className="flex gap-1">
                        {quote.status === "DRAFT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(quote.id, "SENT")}
                          >
                            <Send className="size-3.5 mr-1" />
                            Mark Sent
                          </Button>
                        )}
                        {quote.status === "SENT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(quote.id, "APPROVED")}
                          >
                            <CheckCircle className="size-3.5 mr-1" />
                            Approved
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  {isExpanded && quote.lines.length > 0 && (
                    <div className="mt-3 rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow className="text-xs">
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">
                              Unit Price
                            </TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {quote.lines.map((line) => (
                            <TableRow key={line.id} className="text-sm">
                              <TableCell className="font-medium">
                                {line.description}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {dec(line.qty)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {dec(line.unitPrice)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {dec(line.lineTotal)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

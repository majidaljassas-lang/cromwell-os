"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, ChevronDown, ChevronRight, Send, CheckCircle, ExternalLink, FileText, Trash2, Undo2, PenLine } from "lucide-react";
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
type SiteOption = { id: string; siteName: string };
type CommercialLinkOption = { id: string; siteId: string; customerId: string; site: SiteOption };

interface QuotePanelProps {
  ticketId: string;
  quotes: QuoteData[];
  customers: CustomerData[];
  sites?: SiteOption[];
  commercialLinks?: CommercialLinkOption[];
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
    case "SUPERSEDED":
      return "secondary";
    default:
      return "outline";
  }
}

export function QuotePanel({ ticketId, quotes, customers, sites = [], commercialLinks = [] }: QuotePanelProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviseQuoteId, setReviseQuoteId] = useState<string | null>(null);
  const [reviseReason, setReviseReason] = useState("");
  const [reviseSelectedLines, setReviseSelectedLines] = useState<Set<string>>(new Set());
  const [reviseReplacements, setReviseReplacements] = useState<Record<string, { description: string; qty: string; cost: string; sale: string }>>({});
  const [revising, setRevising] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);

  // PO entry state
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [poQuoteId, setPoQuoteId] = useState<string | null>(null);
  const [submittingPO, setSubmittingPO] = useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().split("T")[0]);
  const [poIssuer, setPoIssuer] = useState("");
  const [poSiteId, setPoSiteId] = useState("");
  const [poNotes, setPoNotes] = useState("");

  function openPOSheet(quoteId: string) {
    setPoQuoteId(quoteId);
    setPoNumber("");
    setPoDate(new Date().toISOString().split("T")[0]);
    setPoIssuer("");
    setPoSiteId("");
    setPoNotes("");
    setPoSheetOpen(true);
  }

  // Get filtered sites for the PO quote's customer
  function getSitesForQuote(customerId: string) {
    const custLinks = commercialLinks.filter(cl => cl.customerId === customerId);
    if (custLinks.length > 0) {
      return { sites: custLinks.map(cl => cl.site), hasLinks: true, links: custLinks };
    }
    return { sites, hasLinks: false, links: [] as CommercialLinkOption[] };
  }

  async function handleSubmitPO() {
    if (!poNumber.trim() || !poQuoteId) return;
    setSubmittingPO(true);
    const quote = quotes.find(q => q.id === poQuoteId);
    if (!quote) { setSubmittingPO(false); return; }

    const { links } = getSitesForQuote(quote.customer.id);

    try {
      const noteParts: string[] = [];
      if (poIssuer.trim()) noteParts.push(`Issued by: ${poIssuer.trim()}`);
      if (poNotes.trim()) noteParts.push(poNotes.trim());

      const body: Record<string, unknown> = {
        ticketId,
        customerId: quote.customer.id,
        poNo: poNumber.trim(),
        poType: "STANDARD_FIXED",
        poDate: poDate || undefined,
        status: "RECEIVED",
        totalValue: quote.totalSell ? Number(quote.totalSell.toString()) : undefined,
        notes: noteParts.length > 0 ? noteParts.join("\n") : undefined,
      };
      if (poSiteId) {
        body.siteId = poSiteId;
        const cl = links.find(l => l.siteId === poSiteId);
        if (cl) body.siteCommercialLinkId = cl.id;
      }

      const res = await fetch("/api/customer-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setPoSheetOpen(false);
        setPoQuoteId(null);
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

  async function handleDelete(quoteId: string, quoteNo: string) {
    if (!confirm(`Delete quote ${quoteNo}? This cannot be undone.`)) return;
    await fetch(`/api/quotes/${quoteId}`, { method: "DELETE" });
    router.refresh();
  }

  async function updateStatus(quoteId: string, status: string) {
    const body: Record<string, unknown> = { status };
    if (status === "SENT") body.issuedAt = new Date().toISOString();
    await fetch(`/api/quotes/${quoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  function openRevise(quoteId: string) {
    setReviseQuoteId(quoteId);
    setReviseReason("");
    setReviseSelectedLines(new Set());
    setReviseOpen(true);
  }

  function toggleReviseLine(lineId: string) {
    setReviseSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
        setReviseReplacements((r) => { const n = { ...r }; delete n[lineId]; return n; });
      } else {
        next.add(lineId);
        setReviseReplacements((r) => ({ ...r, [lineId]: { description: "", qty: "", cost: "", sale: "" } }));
      }
      return next;
    });
  }

  function updateReplacement(lineId: string, field: string, value: string) {
    setReviseReplacements((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], [field]: value },
    }));
  }

  async function handleRevise() {
    if (!reviseQuoteId || reviseSelectedLines.size === 0) return;
    setRevising(true);
    try {
      const res = await fetch(`/api/quotes/${reviseQuoteId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: reviseReason.trim(),
          affectedLineIds: [...reviseSelectedLines],
          replacements: reviseReplacements,
        }),
      });
      if (res.ok) {
        setReviseOpen(false);
        setReviseQuoteId(null);
        setReviseReason("");
        setReviseSelectedLines(new Set());
        setReviseReplacements({});
        router.refresh();
      }
    } finally {
      setRevising(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Quotes</h2>
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
          <CardContent className="py-8 text-center text-[#888888]">
            No quotes generated yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {quotes.map((quote) => {
            const isExpanded = expandedId === quote.id;
            const isSuperseded = quote.status === "SUPERSEDED";
            return (
              <Card key={quote.id} className={isSuperseded ? "opacity-60" : ""}>
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() =>
                        setExpandedId(isExpanded ? null : quote.id)
                      }
                      className="flex items-center gap-2 text-left"
                    >
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-[#888888]" />
                      ) : (
                        <ChevronRight className="size-4 text-[#888888]" />
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
                      <span className="text-sm text-[#888888]">
                        {quote.customer.name}
                      </span>
                      <span className="text-sm font-medium tabular-nums">
                        {dec(quote.totalSell)}
                      </span>
                      {quote.issuedAt && (
                        <span className="text-xs text-[#888888]">
                          Issued:{" "}
                          {new Date(quote.issuedAt).toLocaleDateString()}
                        </span>
                      )}
                      <div className="flex gap-1">
                        <Link href={`/quotes/${quote.id}`}>
                          <Button size="sm" variant="outline" className="bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]">
                            <ExternalLink className="size-3.5 mr-1" />
                            {isSuperseded ? "View" : "Open"}
                          </Button>
                        </Link>
                        {!isSuperseded && quote.status === "DRAFT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(quote.id, "SENT")}
                          >
                            <Send className="size-3.5 mr-1" />
                            Mark Sent
                          </Button>
                        )}
                        {!isSuperseded && quote.status === "SENT" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateStatus(quote.id, "APPROVED")}
                          >
                            <CheckCircle className="size-3.5 mr-1" />
                            Approved
                          </Button>
                        )}
                        {!isSuperseded && quote.status === "APPROVED" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[#00CC66] hover:text-[#00AA55] border-[#333333]"
                            onClick={() => openPOSheet(quote.id)}
                          >
                            <FileText className="size-3.5 mr-1" />
                            Enter PO
                          </Button>
                        )}
                        {!isSuperseded && (quote.status === "SENT" || quote.status === "APPROVED") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[#FF9900] hover:text-[#FF6600] border-[#333333]"
                            onClick={() => openRevise(quote.id)}
                          >
                            <PenLine className="size-3.5 mr-1" />
                            Revise
                          </Button>
                        )}
                        {!isSuperseded && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-500 hover:text-red-400 hover:bg-red-950/30 border-[#333333]"
                            onClick={() => handleDelete(quote.id, quote.quoteNo)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  {isExpanded && quote.lines.length > 0 && (
                    <div className="mt-3 border border-[#333333]">
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

      {/* Enter PO Sheet */}
      <Sheet open={poSheetOpen} onOpenChange={(open) => { setPoSheetOpen(open); if (!open) setPoQuoteId(null); }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Enter Purchase Order</SheetTitle>
            <SheetDescription>
              Enter the customer PO received for this approved quote.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <div className="space-y-1.5">
              <Label htmlFor="qpo-number">PO Number *</Label>
              <Input
                id="qpo-number"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="e.g. PO-12345"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qpo-date">PO Date</Label>
              <Input
                id="qpo-date"
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qpo-issuer">PO Issuer</Label>
              <Input
                id="qpo-issuer"
                value={poIssuer}
                onChange={(e) => setPoIssuer(e.target.value)}
                placeholder="Who issued this PO?"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Site</Label>
              {poQuoteId && (() => {
                const quote = quotes.find(q => q.id === poQuoteId);
                if (!quote) return null;
                const { sites: siteList, hasLinks } = getSitesForQuote(quote.customer.id);
                return (
                  <>
                    {!hasLinks && siteList.length > 0 && (
                      <p className="text-[10px] text-[#FF9900]">No sites linked to this customer. Showing all sites.</p>
                    )}
                    <Select value={poSiteId} onValueChange={(v) => setPoSiteId(v ?? "")}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select site (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">-- None --</SelectItem>
                        {siteList.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.siteName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                );
              })()}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qpo-notes">Notes</Label>
              <Textarea
                id="qpo-notes"
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

      {/* Revise Quote Dialog */}
      <Sheet open={reviseOpen} onOpenChange={(open) => { setReviseOpen(open); if (!open) { setReviseQuoteId(null); setReviseSelectedLines(new Set()); } }}>
        <SheetContent side="right" className="w-[500px] sm:max-w-[500px]">
          <SheetHeader>
            <SheetTitle>Revise Quote</SheetTitle>
            <SheetDescription>
              Select the lines that need changing and explain why.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 overflow-y-auto">
            {/* Lines to select */}
            {reviseQuoteId && (() => {
              const q = quotes.find((qt) => qt.id === reviseQuoteId);
              if (!q) return null;
              return (
                <div className="space-y-1.5">
                  <Label>Select lines to revise ({reviseSelectedLines.size} selected)</Label>
                  <div className="border border-[#333333] max-h-[300px] overflow-y-auto">
                    {q.lines.map((line) => {
                      const isSelected = reviseSelectedLines.has(line.id);
                      const rep = reviseReplacements[line.id];
                      return (
                        <div key={line.id} className={`border-b border-[#2A2A2A] ${isSelected ? "bg-[#FF9900]/10 border-l-2 border-l-[#FF9900]" : ""}`}>
                          <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#222222]">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleReviseLine(line.id)}
                              className="accent-[#FF9900] shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">{line.description}</div>
                              <div className="text-[10px] text-[#888888] tabular-nums">
                                Qty: {dec(line.qty)} &middot; Price: {dec(line.unitPrice)} &middot; Total: {dec(line.lineTotal)}
                              </div>
                            </div>
                          </label>
                          {isSelected && rep && (
                            <div className="px-3 pb-3 pt-1 ml-6 space-y-2 border-t border-[#FF9900]/20">
                              <div className="text-[10px] uppercase tracking-widest text-[#FF9900] font-bold">Replace with</div>
                              <Input
                                value={rep.description}
                                onChange={(e) => updateReplacement(line.id, "description", e.target.value)}
                                placeholder="New item description"
                                className="h-7 text-xs"
                              />
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[9px] text-[#888888]">Qty</label>
                                  <Input
                                    type="number"
                                    value={rep.qty}
                                    onChange={(e) => updateReplacement(line.id, "qty", e.target.value)}
                                    placeholder={String(Number(line.qty))}
                                    className="h-7 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#888888]">Cost</label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={rep.cost}
                                    onChange={(e) => updateReplacement(line.id, "cost", e.target.value)}
                                    placeholder="0.00"
                                    className="h-7 text-xs"
                                  />
                                </div>
                                <div>
                                  <label className="text-[9px] text-[#888888]">Sale</label>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={rep.sale}
                                    onChange={(e) => updateReplacement(line.id, "sale", e.target.value)}
                                    placeholder="0.00"
                                    className="h-7 text-xs"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Textarea
                value={reviseReason}
                onChange={(e) => setReviseReason(e.target.value)}
                rows={3}
                placeholder="e.g. Wrong valves quoted — 35mm should be 22mm. Client advised via phone."
              />
            </div>
            <SheetFooter>
              <Button
                onClick={handleRevise}
                disabled={revising || reviseSelectedLines.size === 0}
                className="bg-[#FF9900] text-black hover:bg-[#FF6600]"
              >
                {revising ? "Revising..." : `Revise ${reviseSelectedLines.size} line${reviseSelectedLines.size !== 1 ? "s" : ""} & Reset to Draft`}
              </Button>
            </SheetFooter>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

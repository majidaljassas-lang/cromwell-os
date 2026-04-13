"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Send, FileText, Eye, Download, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";

type BomComponent = {
  id: string;
  description: string;
  qty: number;
  unit: string;
  expectedCostUnit: number | null;
  expectedCostTotal: number | null;
  supplierName: string | null;
  status: string;
};

type QuoteLine = {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  ticketLine: {
    id: string;
    expectedCostUnit: number | null;
    expectedCostTotal: number | null;
    unit: string;
    isBomParent?: boolean;
    components?: BomComponent[];
  } | null;
};

type Quote = {
  id: string;
  quoteNo: string;
  versionNo: number;
  quoteType: string;
  status: string;
  totalSell: number;
  notes: string | null;
  issuedAt: string | null;
  createdAt: string;
  customer: { id: string; name: string };
  ticket: {
    id: string;
    title: string;
    site: { id: string; siteName: string } | null;
    payingCustomer: { id: string; name: string };
    lines: Array<{
      id: string;
      expectedCostUnit: number | null;
      expectedCostTotal: number | null;
      actualMarginTotal: number | null;
    }>;
  };
  site: { id: string; siteName: string } | null;
  lines: QuoteLine[];
};

function fmt(val: number | null | undefined): string {
  if (val == null) return "—";
  return `£${Number(val).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function QuoteBuilder({ quote }: { quote: Quote & { pdfFileName?: string; pdfPath?: string; pdfGeneratedAt?: string } }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  // Compute totals
  const totalSale = quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0);

  // Map ticket line costs by ID for margin display
  const costMap: Record<string, number> = {};
  for (const tl of quote.ticket.lines) {
    if (tl.expectedCostTotal != null) costMap[tl.id] = Number(tl.expectedCostTotal);
  }

  const totalCost = quote.lines.reduce((s, l) => {
    const tlId = l.ticketLine?.id;
    return s + (tlId && costMap[tlId] ? costMap[tlId] : 0);
  }, 0);

  const totalMargin = totalSale - totalCost;
  const marginPct = totalSale > 0 ? (totalMargin / totalSale) * 100 : 0;

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SENT", issuedAt: new Date().toISOString() }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSending(false);
    }
  }

  async function handleGeneratePdf() {
    setGeneratingPdf(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/generate-pdf`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        // Download the generated PDF
        window.open(`/api/quotes/${quote.id}/generate-pdf`, "_blank");
        router.refresh();
      }
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function handleDownloadPdf() {
    // Always regenerate to ensure latest template
    setGeneratingPdf(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/generate-pdf`, { method: "POST" });
      if (res.ok) {
        window.open(`/api/quotes/${quote.id}/generate-pdf`, "_blank");
      }
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    const res = await fetch(`/api/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) router.refresh();
  }

  const statusColor =
    quote.status === "DRAFT" ? "text-[#FF9900] bg-[#FF9900]/10" :
    quote.status === "SENT" ? "text-[#3399FF] bg-[#3399FF]/10" :
    quote.status === "APPROVED" ? "text-[#00CC66] bg-[#00CC66]/10" :
    "text-[#888888] bg-[#333333]";

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href={`/tickets/${quote.ticket.id}`}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="size-4 mr-1" />
                Ticket
              </Button>
            </Link>
            <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
              {quote.quoteNo}
            </h1>
            <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${statusColor}`}>
              {quote.status}
            </Badge>
            <span className="text-xs text-[#888888]">v{quote.versionNo}</span>
          </div>
          <div className="flex items-center gap-2 ml-[72px] text-sm text-[#888888]">
            <span>{quote.customer.name}</span>
            {quote.site && (
              <>
                <span>/</span>
                <span>{quote.site.siteName}</span>
              </>
            )}
            <span className="text-[10px] text-[#666666] ml-2">
              {quote.quoteType} | {new Date(quote.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/quotes/${quote.id}/view`} target="_blank">
            <Button variant="outline" size="sm" className="bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]">
              <Eye className="size-4 mr-1" />
              Preview
            </Button>
          </a>
          {quote.pdfPath ? (
            <Button variant="outline" size="sm" onClick={handleDownloadPdf} className="bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]">
              <Download className="size-4 mr-1" />
              Download PDF
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={handleGeneratePdf} disabled={generatingPdf} className="bg-[#222222] text-[#E0E0E0] border-[#333333] hover:bg-[#2A2A2A]">
              <FileText className="size-4 mr-1" />
              {generatingPdf ? "Generating..." : "Generate PDF"}
            </Button>
          )}
          {quote.status === "DRAFT" && quote.pdfPath && (
            <Button onClick={handleSend} disabled={sending} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
              <Send className="size-4 mr-1" />
              {sending ? "Sending..." : "Send Quote"}
            </Button>
          )}
          {quote.status === "DRAFT" && !quote.pdfPath && (
            <span className="text-[10px] text-[#888888] bb-mono">Generate PDF before sending</span>
          )}
          {quote.status === "SENT" && (
            <>
              <Button onClick={() => handleStatusChange("APPROVED")} className="bg-[#00CC66] text-black hover:bg-[#00AA55]" size="sm">
                <CheckCircle className="size-4 mr-1" />
                Accepted
              </Button>
              <Button onClick={() => handleStatusChange("REJECTED")} variant="outline" size="sm" className="bg-[#222222] text-[#FF3333] border-[#333333] hover:bg-[#2A2A2A]">
                <XCircle className="size-4 mr-1" />
                Rejected
              </Button>
            </>
          )}
          {quote.issuedAt && (
            <span className="text-[10px] text-[#888888] bb-mono">
              Sent: {new Date(quote.issuedAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Commercial Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">TOTAL SALE</div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{fmt(totalSale)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">TOTAL COST</div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{fmt(totalCost)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">MARGIN</div>
          <div className={`text-lg font-bold bb-mono mt-1 ${totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
            {fmt(totalMargin)}
          </div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">MARGIN %</div>
          <div className={`text-lg font-bold bb-mono mt-1 ${marginPct >= 20 ? "text-[#00CC66]" : marginPct >= 10 ? "text-[#FF9900]" : "text-[#FF3333]"}`}>
            {marginPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Quote Lines Table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333] flex items-center gap-2">
          <FileText className="size-4 text-[#FF6600]" />
          <span className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">QUOTE LINES</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">#</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>UOM</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Line Total</TableHead>
              <TableHead className="text-right text-[#888888]">Cost</TableHead>
              <TableHead className="text-right text-[#888888]">Margin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quote.lines.map((line, i) => {
              const cost = line.ticketLine?.id ? costMap[line.ticketLine.id] ?? 0 : 0;
              const lineMargin = Number(line.lineTotal) - cost;
              const isBom = line.ticketLine?.isBomParent && line.ticketLine?.components?.length;
              const components = line.ticketLine?.components || [];
              return (
                <React.Fragment key={line.id}>
                  <TableRow className={isBom ? "border-b-0" : ""}>
                    <TableCell className="text-[#666666] text-xs">{i + 1}</TableCell>
                    <TableCell className="font-medium">
                      {line.description}
                      {isBom && <span className="ml-2 text-[8px] text-[#3399FF] border border-[#3399FF]/30 px-1 py-0.5 rounded">BOM</span>}
                    </TableCell>
                    <TableCell className="text-[#888888] text-[10px]">{line.ticketLine?.unit || "LOT"}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(line.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(line.unitPrice)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmt(line.lineTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums text-[#888888]">{fmt(cost)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className={lineMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>{fmt(lineMargin)}</span>
                    </TableCell>
                  </TableRow>
                  {isBom && components.map((comp) => (
                    <TableRow key={comp.id} className="bg-[#151515]">
                      <TableCell />
                      <TableCell className="text-xs text-[#AAAAAA] pl-6">
                        <span className="text-[#3399FF] mr-1">{"\u2514"}</span>
                        {comp.description}
                        {comp.supplierName && <span className="text-[10px] text-[#888888] ml-2">({comp.supplierName})</span>}
                      </TableCell>
                      <TableCell className="text-[#888888] text-[10px]">{comp.unit}</TableCell>
                      <TableCell className="text-right tabular-nums text-[#AAAAAA] text-xs">{Number(comp.qty)}</TableCell>
                      <TableCell className="text-right tabular-nums text-[#888888] text-xs">{fmt(comp.expectedCostUnit)}</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums text-[#888888] text-xs">{fmt(comp.expectedCostTotal)}</TableCell>
                      <TableCell>
                        <span className={`text-[9px] px-1 py-0.5 rounded ${comp.status === "FROM_STOCK" ? "bg-[#FF6600]/15 text-[#FF6600]" : "bg-[#333333] text-[#888888]"}`}>
                          {comp.status === "FROM_STOCK" ? "STOCK" : comp.status.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow className="border-t border-[#333333] bg-[#151515]">
              <TableCell colSpan={5} className="text-right text-[11px] uppercase tracking-widest text-[#888888] font-bold">
                TOTALS
              </TableCell>
              <TableCell className="text-right tabular-nums font-bold text-[#E0E0E0]">{fmt(totalSale)}</TableCell>
              <TableCell className="text-right tabular-nums text-[#888888]">{fmt(totalCost)}</TableCell>
              <TableCell className="text-right tabular-nums font-bold">
                <span className={totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>{fmt(totalMargin)}</span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Customer-Facing View (without cost/margin) */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333]">
          <span className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">CUSTOMER VIEW</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-sm text-[#E0E0E0]">
            <strong>To:</strong> {quote.customer.name}
          </div>
          {quote.site && (
            <div className="text-sm text-[#E0E0E0]">
              <strong>Site:</strong> {quote.site.siteName}
            </div>
          )}
          <div className="text-sm text-[#E0E0E0]">
            <strong>Ref:</strong> {quote.quoteNo} v{quote.versionNo}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Price</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {quote.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(line.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(line.unitPrice)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmt(line.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="border-t border-[#333333] bg-[#151515]">
                <TableCell colSpan={3} className="text-right font-bold">Total (Ex VAT)</TableCell>
                <TableCell className="text-right tabular-nums font-bold">{fmt(totalSale)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </div>
    </div>
  );
}

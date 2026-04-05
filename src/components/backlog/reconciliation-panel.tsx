"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, FileText, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type InvoiceMatch = {
  invoiceNumber: string;
  qty: number;
  amount: number;
  rawSite: string | null;
  canonicalSite: string | null;
  siteAliasUsed: boolean;
  orderRefRaw: string | null;
  isBillLinked: boolean;
  invoiceLineType: string;
  billingConfidence: string;
  matchMethod: string | null;
  matchUsedSiteAlias: boolean;
  matchUsedOrderRef: boolean;
};

type ReconRow = {
  id: string;
  product: string;
  rawText: string;
  sender: string;
  date: string;
  requestedQty: number;
  requestedUnit: string;
  invoicedQty: number;
  difference: number;
  invoicedAmount: number;
  status: string;
  invoiceLineType: string;
  billingConfidence: string;
  billLinkedCount: number;
  manualCount: number;
  invoiceMatches: InvoiceMatch[];
};

type Summary = {
  totalTicketLines: number;
  totalInvoiceLines: number;
  totalInvoicedValue: number;
  totalBillLinkedValue: number;
  totalManualValue: number;
  totalUninvoicedLines: number;
  statusCounts: Record<string, number>;
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETE: "text-[#00CC66] bg-[#00CC66]/10",
  PARTIAL: "text-[#FF9900] bg-[#FF9900]/10",
  UNDERBILLED: "text-[#FF3333] bg-[#FF3333]/10",
  NOT_INVOICED: "text-[#FF3333] bg-[#FF3333]/10",
  UNMATCHED: "text-[#888888] bg-[#333333]",
};

const CONF_COLORS: Record<string, string> = {
  HIGH: "text-[#00CC66]",
  MEDIUM: "text-[#FF9900]",
  LOW: "text-[#FF3333]",
  NONE: "text-[#666666]",
};

function fmt(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ReconciliationPanel({ caseId }: { caseId: string }) {
  const [data, setData] = useState<{ reconciliation: ReconRow[]; summary: Summary; unmatchedInvoiceLines: unknown[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterProduct, setFilterProduct] = useState("");
  const [filterInvoice, setFilterInvoice] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterSender, setFilterSender] = useState("ALL");

  useEffect(() => {
    fetch(`/api/reconciliation/summary/${caseId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="text-[#888888] text-sm py-8 text-center">Loading reconciliation data...</div>;
  if (!data || data.reconciliation.length === 0) return <div className="text-[#888888] text-sm py-8 text-center border border-[#333333] bg-[#1A1A1A]">No reconciliation data yet. Extract ticket lines from WhatsApp messages and ingest invoices first.</div>;

  const rows = data.reconciliation;
  const summary = data.summary;
  const senders = [...new Set(rows.map((r) => r.sender))];

  const filtered = rows.filter((r) => {
    if (filterProduct && !r.product.toLowerCase().includes(filterProduct.toLowerCase()) && !r.rawText.toLowerCase().includes(filterProduct.toLowerCase())) return false;
    if (filterInvoice && !r.invoiceMatches.some((m) => m.invoiceNumber.toLowerCase().includes(filterInvoice.toLowerCase()))) return false;
    if (filterStatus !== "ALL" && r.status !== filterStatus) return false;
    if (filterSender !== "ALL" && r.sender !== filterSender) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">INVOICED</div>
          <div className="text-lg font-bold bb-mono text-[#E0E0E0] mt-1">{fmt(summary.totalInvoicedValue)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">BILL-LINKED</div>
          <div className="text-lg font-bold bb-mono text-[#00CC66] mt-1">{fmt(summary.totalBillLinkedValue)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">MANUAL</div>
          <div className="text-lg font-bold bb-mono text-[#FF9900] mt-1">{fmt(summary.totalManualValue)}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">UNINVOICED</div>
          <div className="text-lg font-bold bb-mono text-[#FF3333] mt-1">{summary.totalUninvoicedLines}</div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">STATUS</div>
          <div className="flex gap-2 mt-1 text-[10px] bb-mono">
            <span className="text-[#00CC66]">{summary.statusCounts.COMPLETE || 0}✓</span>
            <span className="text-[#FF9900]">{summary.statusCounts.PARTIAL || 0}◐</span>
            <span className="text-[#FF3333]">{(summary.statusCounts.UNDERBILLED || 0) + (summary.statusCounts.NOT_INVOICED || 0)}✗</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[8px] text-[#666666] uppercase tracking-widest">FILTER:</span>
        <Input value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} placeholder="Product..." className="h-6 w-36 text-[10px] bg-[#222222] border-[#333333]" />
        <Input value={filterInvoice} onChange={(e) => setFilterInvoice(e.target.value)} placeholder="Invoice #..." className="h-6 w-28 text-[10px] bg-[#222222] border-[#333333]" />
        <span className="text-[#555555]">|</span>
        {["ALL", "COMPLETE", "UNDERBILLED", "PARTIAL", "NOT_INVOICED"].map((s) => (
          <button key={s} onClick={() => setFilterStatus(s)} className={`text-[9px] px-2 py-0.5 ${filterStatus === s ? "bg-[#FF6600] text-black" : "text-[#888888]"}`}>{s === "ALL" ? "All" : s.replace(/_/g, " ")}</button>
        ))}
        <span className="text-[#555555]">|</span>
        <button onClick={() => setFilterSender("ALL")} className={`text-[9px] px-2 py-0.5 ${filterSender === "ALL" ? "bg-[#FF6600] text-black" : "text-[#888888]"}`}>All</button>
        {senders.map((s) => (
          <button key={s} onClick={() => setFilterSender(s)} className={`text-[9px] px-2 py-0.5 ${filterSender === s ? "bg-[#3399FF] text-black" : "text-[#888888]"}`}>{s.split(" ")[0]}</button>
        ))}
      </div>

      <div className="text-xs text-[#888888] bb-mono">Showing {filtered.length} of {rows.length} lines</div>

      {/* Reconciliation table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="text-[9px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
              <th className="w-6 px-2 py-1.5"></th>
              <th className="text-left px-2 py-1.5">Product</th>
              <th className="text-right px-2 py-1.5 w-16">Req</th>
              <th className="text-right px-2 py-1.5 w-16">Inv</th>
              <th className="text-right px-2 py-1.5 w-16">Diff</th>
              <th className="text-left px-2 py-1.5 w-20">Status</th>
              <th className="text-left px-2 py-1.5 w-20">Type</th>
              <th className="text-left px-2 py-1.5 w-14">Conf</th>
              <th className="text-right px-2 py-1.5 w-20">Amount</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const isExpanded = expandedId === row.id;
              return (
                <tr key={row.id} className="border-b border-[#2A2A2A]">
                  <td colSpan={9} className="p-0">
                    {/* Main row */}
                    <div className="flex items-center cursor-pointer hover:bg-[#222222] px-2 py-2" onClick={() => setExpandedId(isExpanded ? null : row.id)}>
                      <div className="w-6 shrink-0">
                        {isExpanded ? <ChevronDown className="size-3 text-[#888888]" /> : <ChevronRight className="size-3 text-[#888888]" />}
                      </div>
                      <div className="flex-1 text-xs text-[#E0E0E0] font-medium">{row.product}</div>
                      <div className="w-16 text-right text-xs bb-mono text-[#E0E0E0]">{row.requestedQty}</div>
                      <div className="w-16 text-right text-xs bb-mono text-[#E0E0E0]">{row.invoicedQty}</div>
                      <div className={`w-16 text-right text-xs bb-mono ${row.difference >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>{row.difference >= 0 ? "+" : ""}{row.difference}</div>
                      <div className="w-20 px-2"><Badge className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${STATUS_COLORS[row.status] || "text-[#888888] bg-[#333333]"}`}>{row.status.replace(/_/g, " ")}</Badge></div>
                      <div className="w-20 px-2"><Badge className={`text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${row.invoiceLineType === "BILL_LINKED" ? "text-[#00CC66] bg-[#00CC66]/10" : row.invoiceLineType === "MANUAL_INVOICE_LINE" ? "text-[#FF9900] bg-[#FF9900]/10" : row.invoiceLineType === "MIXED" ? "text-[#3399FF] bg-[#3399FF]/10" : "text-[#666666] bg-[#222222]"}`}>{row.invoiceLineType === "BILL_LINKED" ? "BILL-LINKED" : row.invoiceLineType === "MANUAL_INVOICE_LINE" ? "MANUAL" : row.invoiceLineType}</Badge></div>
                      <div className={`w-14 text-xs bb-mono ${CONF_COLORS[row.billingConfidence] || "text-[#666666]"}`}>{row.billingConfidence}</div>
                      <div className="w-20 text-right text-xs bb-mono text-[#E0E0E0]">{fmt(row.invoicedAmount)}</div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="bg-[#151515] border-t border-[#333333] px-4 py-3 space-y-3">
                        {/* Original WhatsApp message */}
                        <div className="flex items-start gap-2">
                          <MessageSquare className="size-4 text-[#FF6600] shrink-0 mt-0.5" />
                          <div>
                            <div className="text-[9px] text-[#888888] uppercase tracking-widest">WHATSAPP ORDER</div>
                            <div className="text-xs text-[#E0E0E0] mt-1">
                              <span className="text-[#3399FF] font-bold">{row.sender}</span>
                              <span className="text-[#666666] ml-2">{new Date(row.date).toLocaleDateString("en-GB")}</span>
                            </div>
                            <div className="text-xs text-[#888888] mt-0.5 whitespace-pre-wrap bg-[#1A1A1A] border border-[#333333] p-2">{row.rawText}</div>
                          </div>
                        </div>

                        {/* Linked invoice lines */}
                        {row.invoiceMatches.length > 0 && (
                          <div className="flex items-start gap-2">
                            <FileText className="size-4 text-[#3399FF] shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <div className="text-[9px] text-[#888888] uppercase tracking-widest">INVOICE LINES ({row.invoiceMatches.length})</div>
                              <div className="mt-1 space-y-1">
                                {row.invoiceMatches.map((m, i) => (
                                  <div key={i} className="border border-[#333333] bg-[#1A1A1A] px-3 py-2 text-xs">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[#E0E0E0] font-bold">{m.invoiceNumber}</span>
                                        <span className="text-[#888888]">×{m.qty}</span>
                                        <span className="text-[#E0E0E0] bb-mono">{fmt(m.amount)}</span>
                                        <Badge className={`text-[7px] px-1 py-0 ${m.isBillLinked ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10"}`}>
                                          {m.isBillLinked ? "BILL-LINKED" : "MANUAL"}
                                        </Badge>
                                        <span className={`text-[8px] ${CONF_COLORS[m.billingConfidence]}`}>{m.billingConfidence}</span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-[9px] text-[#666666]">
                                      <span>Site: <span className="text-[#888888]">{m.rawSite || "—"}</span>{m.siteAliasUsed && <span className="text-[#FF6600] ml-1">→ {m.canonicalSite}</span>}</span>
                                      {m.orderRefRaw && <span>Ref: <span className="text-[#888888]">{m.orderRefRaw.slice(0, 40)}</span></span>}
                                    </div>
                                    <div className="text-[8px] text-[#555555] mt-0.5">
                                      Match: {m.matchMethod || "—"}
                                      {m.matchUsedSiteAlias && <Badge className="text-[6px] px-1 py-0 ml-1 text-[#FF6600] bg-[#FF6600]/10">SITE ALIAS</Badge>}
                                      {m.matchUsedOrderRef && <Badge className="text-[6px] px-1 py-0 ml-1 text-[#3399FF] bg-[#3399FF]/10">ORDER REF</Badge>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {row.invoiceMatches.length === 0 && (
                          <div className="text-xs text-[#FF3333]">No invoice lines matched to this ticket line.</div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

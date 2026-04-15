"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Package,
  ArrowRightLeft,
  Undo2,
  Warehouse,
  Upload,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

// ── Helpers ──

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string | Date | null): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-GB");
}

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "MATCHED":
      return "default";
    case "PARTIAL":
    case "SUGGESTED":
      return "secondary";
    case "EXCEPTION":
    case "UNALLOCATED":
      return "destructive";
    default:
      return "outline";
  }
}

type Candidate = {
  source: "TICKET_LINE" | "PO_LINE" | "INVOICE_LINE";
  recordId: string;
  ticketId: string | null;
  siteId: string | null;
  customerId: string | null;
  description: string;
  productCode: string | null;
  qty: number | null;
  confidence: number;
  reasons: string[];
};

function SuggestedMatchCell({ line, onChange }: { line: SupplierBillLine; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [working, setWorking] = useState(false);

  async function unmatchAndShow() {
    setWorking(true);
    try {
      // Reset to UNALLOCATED so we can re-pick (also clears CostAllocations server-side via REJECT path)
      await fetch(`/api/supplier-bills/lines/${line.id}/suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECT" }),
      });
      await loadSuggestions();
    } finally { setWorking(false); onChange(); }
  }

  // If the line is already MATCHED, show destination + Reassign/Reject affordance
  if (line.allocationStatus === "MATCHED") {
    if (open) {
      // Re-render the candidate picker
      return (
        <div className="border border-[#333333] bg-[#0F0F0F] p-2 space-y-1.5 max-w-xl">
          <div className="text-[10px] text-muted-foreground">Choose a different match or reject:</div>
          {candidates && candidates.length === 0 && <div className="text-muted-foreground">No alternates found.</div>}
          {candidates?.slice(0, 5).map((c) => (
            <div key={c.recordId} className="flex items-center gap-2">
              <Badge variant="outline" className="shrink-0">{c.source.replace("_", " ").toLowerCase()}</Badge>
              <span className="text-xs flex-1 truncate" title={c.description}>{c.description}</span>
              <span className="text-xs text-muted-foreground">conf {c.confidence}</span>
              <Button size="sm" variant="default" className="h-5 text-[10px] px-2" onClick={() => approve(c)} disabled={working}>
                Approve
              </Button>
            </div>
          ))}
          <div className="flex justify-between pt-1">
            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => setOpen(false)}>Close</Button>
            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 text-red-400" onClick={reject} disabled={working}>
              Reject all → EXCEPTION
            </Button>
          </div>
        </div>
      );
    }
    return line.ticket || line.site || line.customer ? (
      <div className="space-y-0.5">
        {line.ticket && (
          <div className="flex items-center gap-1.5">
            <a href={`/tickets/${line.ticket.id}`} className="text-primary hover:underline">
              #{line.ticket.ticketNo} {line.ticket.title}
            </a>
            <Button
              size="sm"
              variant="outline"
              className="h-4 px-1.5 text-[10px] text-amber-400 border-amber-700/50"
              title="This match is wrong — pick another or reject"
              onClick={unmatchAndShow}
              disabled={working}
            >
              ✗ Reassign
            </Button>
          </div>
        )}
        {line.site && (
          <div>
            Site: <a href={`/sites/${line.site.id}`} className="text-primary hover:underline">{line.site.siteName}</a>
          </div>
        )}
        {line.customer && <div className="text-muted-foreground">Customer: {line.customer.name}</div>}
      </div>
    ) : <span className="text-muted-foreground italic">matched (no link data)</span>;
  }

  async function loadSuggestions() {
    setLoading(true);
    try {
      const r = await fetch(`/api/supplier-bills/lines/${line.id}/suggestions`);
      const j = await r.json();
      setCandidates(j.candidates ?? []);
      setOpen(true);
    } finally { setLoading(false); }
  }

  async function approve(c: Candidate) {
    setWorking(true);
    await fetch(`/api/supplier-bills/lines/${line.id}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "APPROVE", recordType: c.source, recordId: c.recordId }),
    });
    setWorking(false);
    setOpen(false);
    onChange();
  }
  async function reject() {
    setWorking(true);
    await fetch(`/api/supplier-bills/lines/${line.id}/suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "REJECT" }),
    });
    setWorking(false);
    onChange();
  }

  async function approveCurrent() {
    // Approve the line's existing pre-populated ticket directly (the auto-linker put it there).
    // We need to re-derive the ticketLineId — fetch suggestions and pick the top candidate that matches this ticket
    setWorking(true);
    try {
      const r = await fetch(`/api/supplier-bills/lines/${line.id}/suggestions`);
      const j = await r.json();
      const best = j.candidate ?? (j.candidates ?? [])[0];
      if (best) {
        await fetch(`/api/supplier-bills/lines/${line.id}/suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "APPROVE", recordType: best.source, recordId: best.recordId }),
        });
      }
    } finally { setWorking(false); onChange(); }
  }

  // SUGGESTED → show a button to expand candidates
  if (line.allocationStatus === "SUGGESTED" || line.allocationStatus === "UNALLOCATED") {
    return (
      <div className="space-y-1">
        {line.ticket && (
          <div className="flex items-center gap-2">
            <a href={`/tickets/${line.ticket.id}`} className="text-primary hover:underline">
              #{line.ticket.ticketNo} {line.ticket.title}
            </a>
            <span className="text-amber-500 text-[10px]">(suggested)</span>
            <Button
              size="sm"
              variant="default"
              className="h-5 px-2 text-[10px]"
              onClick={approveCurrent}
              disabled={working}
              title="Accept this match — sets MATCHED + creates CostAllocation"
            >
              {working ? "..." : "✓ Accept"}
            </Button>
          </div>
        )}
        {!open ? (
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={loadSuggestions} disabled={loading}>
            {loading ? "..." : line.ticket ? "Show alternates / split" : "Find matches"}
          </Button>
        ) : (
          <div className="border border-[#333333] bg-[#0F0F0F] p-2 space-y-2 max-w-xl">
            {/* Manual search box — pick ANY ticket / PO / invoice line */}
            <ManualLinkSearch onPick={(c) => approve(c as Candidate)} working={working} initialQ={line.description.split(/\s+/).slice(0, 3).join(" ")} />

            {/* Auto suggestions */}
            <div className="border-t border-[#222] pt-2 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto suggestions</div>
              {candidates && candidates.length === 0 && <div className="text-muted-foreground text-xs">No auto candidates.</div>}
              {candidates?.slice(0, 5).map((c) => (
                <div key={c.recordId} className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0">{c.source.replace("_", " ").toLowerCase()}</Badge>
                  <span className="text-xs flex-1 truncate" title={c.description}>{c.description}</span>
                  <span className="text-xs text-muted-foreground">conf {c.confidence}</span>
                  <Button size="sm" variant="default" className="h-5 text-[10px] px-2" onClick={() => approve(c)} disabled={working}>
                    Approve
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-1 border-t border-[#222]">
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => setOpen(false)}>Close</Button>
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 text-red-400" onClick={reject} disabled={working}>
                Reject all → EXCEPTION
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return <span className="text-muted-foreground italic">{line.allocationStatus.toLowerCase()}</span>;
}

// Drill-down panel for a single IntakeDocument
function DocumentDrillDown({ data }: { data: unknown }) {
  if (!data) return <div className="text-xs text-muted-foreground">No data.</div>;
  const d = data as { doc: any; bill: any | null };
  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div><span className="text-muted-foreground">Source:</span> {d.doc.sourceType}</div>
        <div><span className="text-muted-foreground">Status:</span> <Badge variant="outline" style={{ color: QUEUE_STATUS_COLOR[d.doc.status] ?? "#888" }}>{d.doc.status}</Badge></div>
        <div><span className="text-muted-foreground">Retries:</span> {d.doc.retryCount}</div>
        <div><span className="text-muted-foreground">Parse conf:</span> {d.doc.parseConfidence ?? "—"}</div>
      </div>
      {d.doc.errorMessage && (
        <div className="text-red-400">⚠ {d.doc.errorMessage}</div>
      )}
      {d.doc.rawTextExcerpt && (
        <details className="border border-[#222] p-2">
          <summary className="text-muted-foreground cursor-pointer">Raw text ({d.doc.rawTextLength} chars) — click to expand</summary>
          <pre className="text-[10px] mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{d.doc.rawTextExcerpt}</pre>
        </details>
      )}
      {d.bill ? (
        <div className="border border-[#222]">
          <div className="px-2 py-1 bg-[#1A1A1A] text-[10px] uppercase tracking-wider text-muted-foreground">
            Linked bill: {d.bill.supplier?.name} {d.bill.billNo} · £{Number(d.bill.totalCost).toFixed(2)} · {d.bill.lines?.length ?? 0} lines
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Top match</TableHead>
                <TableHead>Allocations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.bill.lines?.map((l: any) => {
                const top = l.billLineMatches?.[0];
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs max-w-md truncate" title={l.description}>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{Number(l.qty).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">£{Number(l.lineTotal).toFixed(2)}</TableCell>
                    <TableCell><Badge variant="outline">{l.allocationStatus}</Badge></TableCell>
                    <TableCell className="text-[10px]">
                      {top ? (
                        <div>
                          <div>{top.candidateType.toLowerCase().replace("_"," ")} · overall <span style={{ color: Number(top.overallConfidence) >= 80 ? "#00CC66" : "#FF9900" }}>{Number(top.overallConfidence).toFixed(0)}</span></div>
                          <div className="text-muted-foreground">prod {Number(top.productConfidence).toFixed(0)} · tkt {Number(top.ticketConfidence).toFixed(0)} · site {Number(top.siteConfidence).toFixed(0)} · sup {Number(top.supplierConfidence).toFixed(0)} · ent {Number(top.entityConfidence).toFixed(0)}</div>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-[10px]">
                      {l.billLineAllocations?.length ? l.billLineAllocations.map((a: any) => (
                        <div key={a.id}>
                          <span style={{ color: a.allocationType === "TICKET_LINE" ? "#00CC66" : a.allocationType === "STOCK" ? "#00CCFF" : a.allocationType === "RETURNS_CANDIDATE" ? "#FF9900" : "#888" }}>
                            {Number(a.qtyAllocated).toFixed(2)} → {a.allocationType === "TICKET_LINE" && a.ticketLine?.ticket ? `#${a.ticketLine.ticket.ticketNo}` : a.allocationType.replace("_"," ").toLowerCase()}
                          </span>
                        </div>
                      )) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-muted-foreground italic">No bill linked yet — still in the queue.</div>
      )}
    </div>
  );
}

// Learning History — recent BillIntakeCorrection rows, grouped + tabular
type LearningEvent = {
  id: string;
  correctionType: string;
  createdAt: string;
  before: unknown;
  after: unknown;
  billNo: string | null;
  supplier: string | null;
  lineDescription: string | null;
};

function LearningHistoryPanel() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<LearningEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/intake/learning");
      const j = await r.json();
      setCounts(j.counts ?? {});
      setRecent(j.recent ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0) return null;

  return (
    <div className="border border-[#333333] bg-[#0F0F0F] p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">🧠 Engine learning</div>
          <div className="text-sm">
            <span className="text-[#FF6600] font-medium">{total}</span> corrections recorded ·
            {Object.entries(counts).map(([k, n]) => ` ${k.replace(/_/g, " ").toLowerCase()} ${n}`).join(" ·")}
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{open ? "▾" : "▸"} {loading ? "…" : "show recent"}</span>
      </button>
      {open && (
        <div className="mt-3 border border-[#333333]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Bill #</TableHead>
                <TableHead>Line</TableHead>
                <TableHead>Δ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.slice(0, 25).map((e) => {
                const before = e.before as Record<string, unknown> | null;
                const after  = e.after  as Record<string, unknown> | null;
                const summary =
                  e.correctionType === "REJECTED"          ? "→ EXCEPTION"
                  : e.correctionType === "TICKET_REASSIGNED"
                    ? `tkt ${(before?.ticketId as string)?.slice(0,6) ?? "—"} → ${(after?.ticketId as string)?.slice(0,6) ?? "—"}`
                  : e.correctionType === "SURPLUS_ROUTED"
                    ? `→ ${(after?.actionedAs as string) ?? "?"}`
                  : e.correctionType === "SKU_MAPPED"
                    ? `confirmed → ${(after?.recordType as string) ?? "?"}`
                  : "—";
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {new Date(e.createdAt).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{e.correctionType.replace(/_/g, " ").toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.supplier ?? "—"}</TableCell>
                    <TableCell className="text-xs">{e.billNo ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[28ch] truncate" title={e.lineDescription ?? ""}>
                      {e.lineDescription ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{summary}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// Returns Candidates panel — surfaces RETURNS_CANDIDATE allocations from the engine
type ReturnCandidate = {
  id: string;
  qtyAllocated: string | number;
  costAllocated: string | number;
  reason: string | null;
  confidence: string | number | null;
  supplierBillLine: {
    id: string;
    description: string;
    supplierBill: { id: string; billNo: string; billDate: string; supplier: { id: string; name: string } };
  };
  ticketLine: { id: string; description: string; ticket: { id: string; ticketNo: number; title: string } } | null;
  site: { id: string; siteName: string } | null;
  customer: { id: string; name: string } | null;
};

function ReturnsCandidatesPanel() {
  const [candidates, setCandidates] = useState<ReturnCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/intake/returns/candidates");
      const j = await r.json();
      setCandidates(j.candidates ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function action(id: string, act: "APPROVE" | "REJECT_TO_STOCK" | "REJECT_TO_WRITE_OFF") {
    setWorking(id);
    try {
      await fetch("/api/intake/returns/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocationId: id, action: act }),
      });
      await refresh();
    } finally { setWorking(null); }
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="border border-[#333333] bg-[#0F0F0F] p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Returns Candidates from allocation engine</div>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={refresh} disabled={loading}>↻</Button>
        </div>
        <div className="text-sm text-muted-foreground">{loading ? "Loading…" : "No surplus pending — engine has nothing to send back right now."}</div>
      </div>
    );
  }

  const totalCost = candidates.reduce((s, c) => s + Number(c.costAllocated ?? 0), 0);

  return (
    <div className="border border-[#333333] bg-[#0F0F0F] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Returns Candidates from allocation engine</div>
          <div className="text-xl font-medium tabular-nums" style={{ color: "#FF9900" }}>
            £{totalCost.toFixed(2)} pending across {candidates.length} surplus line{candidates.length === 1 ? "" : "s"}
          </div>
        </div>
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={refresh} disabled={loading}>↻ Refresh</Button>
      </div>
      <div className="border border-[#333333]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead>Bill #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>From Ticket</TableHead>
              <TableHead className="text-right">Qty surplus</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs">{c.supplierBillLine.supplierBill.supplier.name}</TableCell>
                <TableCell className="text-xs">{c.supplierBillLine.supplierBill.billNo}</TableCell>
                <TableCell className="text-xs max-w-[28ch] truncate" title={c.supplierBillLine.description}>
                  {c.supplierBillLine.description}
                </TableCell>
                <TableCell className="text-xs">
                  {c.ticketLine ? (
                    <a href={`/tickets/${c.ticketLine.ticket.id}`} className="text-primary hover:underline">
                      #{c.ticketLine.ticket.ticketNo}
                    </a>
                  ) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{Number(c.qtyAllocated).toFixed(2)}</TableCell>
                <TableCell className="text-right tabular-nums">£{Number(c.costAllocated).toFixed(2)}</TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[20ch] truncate" title={c.reason ?? ""}>
                  {c.reason ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex gap-1 justify-end">
                    <Button
                      size="sm" variant="default"
                      className="h-5 text-[10px] px-2"
                      onClick={() => action(c.id, "APPROVE")}
                      disabled={working === c.id}
                      title="Create a Return + ReturnLine; supplier owes us a credit for this qty"
                    >
                      ✓ Return to supplier
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-5 text-[10px] px-2"
                      onClick={() => action(c.id, "REJECT_TO_STOCK")}
                      disabled={working === c.id}
                      title="Keep in our stock — creates a StockExcessRecord"
                    >
                      📦 Stock
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-5 text-[10px] px-2 text-red-400"
                      onClick={() => action(c.id, "REJECT_TO_WRITE_OFF")}
                      disabled={working === c.id}
                      title="Absorb as overhead — write off the cost"
                    >
                      ✗ Write-off
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Per-axis confidence breakdown — answers "why did this match score X?"
function ConfidenceBreakdown({ matches }: { matches: NonNullable<SupplierBillLine["billLineMatches"]> }) {
  const [open, setOpen] = useState(false);
  if (matches.length === 0) return null;
  const top = matches[0];
  const overall = Number(top.overallConfidence ?? 0);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[10px] px-1.5 h-4 border border-[#333] rounded text-muted-foreground hover:text-[#FF6600]"
        title={`Top match overall conf ${overall} — click for breakdown`}
      >
        🔍 {overall}
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 border border-[#333] bg-[#0F0F0F] p-2 min-w-[280px] text-xs space-y-1.5 shadow-xl">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-[#222] pb-1">
            Top {Math.min(3, matches.length)} candidate{matches.length === 1 ? "" : "s"} considered
          </div>
          {matches.slice(0, 3).map((m) => (
            <div key={m.id} className="space-y-0.5 pb-2 border-b border-[#222] last:border-0">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px]">{m.candidateType.replace("_", " ").toLowerCase()}</Badge>
                <span className="text-[10px] text-muted-foreground">{m.action}</span>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { label: "prod", val: Number(m.productConfidence ?? 0) },
                  { label: "tkt",  val: Number(m.ticketConfidence ?? 0) },
                  { label: "site", val: Number(m.siteConfidence ?? 0) },
                  { label: "sup",  val: Number(m.supplierConfidence ?? 0) },
                  { label: "ent",  val: Number(m.entityConfidence ?? 0) },
                ].map((axis) => (
                  <div key={axis.label} className="text-center">
                    <div className="text-[9px] text-muted-foreground uppercase">{axis.label}</div>
                    <div className="text-[10px] tabular-nums" style={{ color: axis.val >= 80 ? "#00CC66" : axis.val >= 50 ? "#FF9900" : "#FF3333" }}>
                      {axis.val.toFixed(0)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] tabular-nums">
                Overall: <span style={{ color: Number(m.overallConfidence ?? 0) >= 80 ? "#00CC66" : "#FF9900" }}>
                  {Number(m.overallConfidence ?? 0).toFixed(0)}
                </span>
              </div>
              {Array.isArray(m.reasons) && m.reasons.length > 0 && (
                <div className="text-[10px] text-muted-foreground italic">
                  {(m.reasons as string[]).slice(0, 3).join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Manual search across TicketLine / CustomerPOLine / SalesInvoiceLine
function ManualLinkSearch({ onPick, working, initialQ }: { onPick: (c: unknown) => void; working: boolean; initialQ?: string }) {
  const [q, setQ] = useState(initialQ ?? "");
  const [results, setResults] = useState<Array<{ source: string; recordId: string; description: string; label: string; customer: string | null; site: string | null; qty: number }>>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);

  async function search(query: string) {
    if (query.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await fetch(`/api/intake/search-targets?q=${encodeURIComponent(query)}`);
      const j = await r.json();
      setResults(j.candidates ?? []);
      setShowResults(true);
    } finally { setSearching(false); }
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Manual link — search any ticket / PO / invoice</div>
      <div className="flex gap-1">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") search(q); }}
          placeholder="Type description, ticket #, etc."
          className="flex-1 h-6 px-2 text-xs bg-[#0A0A0A] border border-[#333333] focus:border-[#FF6600] outline-none"
        />
        <Button size="sm" variant="outline" className="h-6 text-[10px] px-2" onClick={() => search(q)} disabled={searching}>
          {searching ? "..." : "Search"}
        </Button>
      </div>
      {showResults && (
        <div className="max-h-48 overflow-y-auto border border-[#222] bg-[#0A0A0A]">
          {results.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">No matches.</div>
          ) : (
            results.slice(0, 15).map((c) => (
              <div key={`${c.source}-${c.recordId}`} className="flex items-center gap-2 px-2 py-1 hover:bg-[#1A1A1A] border-b border-[#222] last:border-0">
                <Badge variant="outline" className="shrink-0 text-[9px]">{c.source.replace("_", " ").toLowerCase()}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" title={c.description}>{c.description}</div>
                  <div className="text-[10px] text-muted-foreground">{c.label}{c.customer ? ` · ${c.customer}` : ""}{c.site ? ` · ${c.site}` : ""} · qty {c.qty}</div>
                </div>
                <Button size="sm" variant="default" className="h-5 text-[10px] px-2" onClick={() => onPick(c)} disabled={working}>
                  Pick
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function classificationVariant(
  c: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (c) {
    case "BILLABLE":
      return "default";
    case "ABSORBED":
      return "secondary";
    case "WRITE_OFF":
      return "destructive";
    default:
      return "outline";
  }
}

// ── Types ──

type SupplierBillLine = {
  id: string;
  description: string;
  qty: Decimal;
  unitCost: Decimal;
  lineTotal: Decimal;
  costClassification: string;
  allocationStatus: string;
  ticket?: {
    id: string;
    ticketNo: number;
    title: string;
    invoices?: Array<{
      id: string;
      invoiceNo: string;
      status: string;
      lines: Array<{
        id: string;
        ticketLineId: string;
        description: string;
        qty: Decimal;
        unitPrice: Decimal;
        lineTotal: Decimal;
      }>;
    }>;
  } | null;
  site?: { id: string; siteName: string } | null;
  customer?: { id: string; name: string } | null;
  costAllocations?: Array<{
    id: string;
    ticketLine: {
      id: string;
      description: string;
      invoiceLines: Array<{
        id: string;
        qty: Decimal;
        unitPrice: Decimal;
        lineTotal: Decimal;
        salesInvoice: { id: string; invoiceNo: string; status: string };
      }>;
    };
  }>;
  billLineAllocations?: Array<{
    id: string;
    allocationType: "TICKET_LINE" | "STOCK" | "RETURNS_CANDIDATE" | "OVERHEAD" | "UNRESOLVED";
    qtyAllocated: Decimal;
    costAllocated: Decimal;
    confidence: Decimal | null;
    reason: string | null;
    ticketLine: { id: string; description: string; ticket: { id: string; ticketNo: number; title: string } } | null;
    site: { id: string; siteName: string } | null;
    customer: { id: string; name: string } | null;
  }>;
  billLineMatches?: Array<{
    id: string;
    candidateType: string;
    candidateId: string;
    supplierConfidence: Decimal | null;
    productConfidence: Decimal | null;
    ticketConfidence: Decimal | null;
    siteConfidence: Decimal | null;
    entityConfidence: Decimal | null;
    overallConfidence: Decimal | null;
    action: string;
    reasons: unknown;
  }>;
};

type SupplierBill = {
  id: string;
  billNo: string;
  billDate: string;
  siteRef: string | null;
  customerRef: string | null;
  status: string;
  totalCost: Decimal;
  supplier: { id: string; name: string };
  lines: SupplierBillLine[];
  _count: { lines: number };
  duplicateStatus?: string | null;
  duplicateOf?: { id: string; billNo: string } | null;
};

type CostAllocationItem = {
  id: string;
  qtyAllocated: Decimal;
  unitCost: Decimal;
  totalCost: Decimal;
  allocationStatus: string;
  confidenceScore: Decimal;
  notes: string | null;
  ticketLine: { id: string; description: string };
  supplierBillLine: {
    id: string;
    description: string;
    supplierBill: { id: string; billNo: string };
  };
};

type AbsorbedCostItem = {
  id: string;
  description: string;
  amount: Decimal;
  allocationBasis: string | null;
  createdAt: string;
  supplierBillLine: { id: string; description: string };
  ticket: { id: string; title: string };
};

type ReturnLineItem = {
  id: string;
  qtyReturned: Decimal;
  expectedCredit: Decimal;
  status: string;
};

type ReturnItem = {
  id: string;
  returnDate: string;
  status: string;
  notes: string | null;
  supplier: { id: string; name: string };
  ticket: { id: string; title: string };
  lines: ReturnLineItem[];
};

type StockExcessItem = {
  id: string;
  purchasedCost: Decimal;
  usedCost: Decimal;
  excessCost: Decimal;
  treatment: string;
  status: string;
  supplierBillLine: { id: string; description: string };
  ticketLine: { id: string; description: string } | null;
};

type ReallocationItem = {
  id: string;
  amount: Decimal;
  reason: string | null;
  createdAt: string;
  fromTicketLine: {
    id: string;
    description: string;
    ticket: { id: string; title: string };
  };
  toTicketLine: {
    id: string;
    description: string;
    ticket: { id: string; title: string };
  };
};

type SupplierOption = { id: string; name: string };
type TicketOption = { id: string; title: string };

type Props = {
  supplierBills: SupplierBill[];
  unresolvedAllocations: CostAllocationItem[];
  absorbedCosts: AbsorbedCostItem[];
  returns: ReturnItem[];
  stockExcess: StockExcessItem[];
  reallocations: ReallocationItem[];
  suppliers: SupplierOption[];
  tickets: TicketOption[];
};

export function ProcurementView({
  supplierBills,
  unresolvedAllocations,
  absorbedCosts,
  returns,
  stockExcess,
  reallocations,
  suppliers,
  tickets,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Procurement</h1>
          <p className="text-sm text-muted-foreground">
            Cost truth -- supplier bills, allocations, returns, and stock management
          </p>
        </div>
      </div>

      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills">
            <FileText className="size-4 mr-1.5" />
            Bills ({supplierBills.length})
          </TabsTrigger>
          <TabsTrigger value="allocations">
            <Package className="size-4 mr-1.5" />
            Allocations ({unresolvedAllocations.length})
          </TabsTrigger>
          <TabsTrigger value="absorbed">
            Absorbed ({absorbedCosts.length})
          </TabsTrigger>
          <TabsTrigger value="returns">
            <Undo2 className="size-4 mr-1.5" />
            Returns ({returns.length})
          </TabsTrigger>
          <TabsTrigger value="stock">
            <Warehouse className="size-4 mr-1.5" />
            MOQ / Stock ({stockExcess.length})
          </TabsTrigger>
          <TabsTrigger value="motable">
            💰 Money on Table
          </TabsTrigger>
          <TabsTrigger value="queue">
            📥 Intake Queue
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: SUPPLIER BILLS ── */}
        <TabsContent value="bills" className="mt-4">
          <SupplierBillsTab
            bills={supplierBills}
            suppliers={suppliers}
          />
        </TabsContent>

        {/* ── TAB 2: COST ALLOCATIONS ── */}
        <TabsContent value="allocations" className="mt-4">
          <CostAllocationsTab
            unresolvedAllocations={unresolvedAllocations}
            supplierBills={supplierBills}
            tickets={tickets}
          />
        </TabsContent>

        {/* ── TAB 3: ABSORBED COSTS ── */}
        <TabsContent value="absorbed" className="mt-4">
          <AbsorbedCostsTab
            absorbedCosts={absorbedCosts}
            tickets={tickets}
          />
        </TabsContent>

        {/* ── TAB 4: RETURNS & CREDITS ── */}
        <TabsContent value="returns" className="mt-4">
          <ReturnsTab
            returns={returns}
            suppliers={suppliers}
            tickets={tickets}
          />
        </TabsContent>

        {/* ── TAB 5: MOQ / STOCK / REALLOCATIONS ── */}
        <TabsContent value="stock" className="mt-4">
          <StockTab
            stockExcess={stockExcess}
            reallocations={reallocations}
          />
        </TabsContent>

        {/* ── TAB 6: MONEY ON THE TABLE ── */}
        <TabsContent value="motable" className="mt-4">
          <MoneyOnTableTab bills={supplierBills} />
        </TabsContent>

        {/* ── TAB 7: INTAKE QUEUE ── */}
        <TabsContent value="queue" className="mt-4">
          <IntakeQueueTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 7: Intake Queue (Bills Intake Engine status)
// ────────────────────────────────────────────────────────────────────────────

type QueueDoc = {
  id: string;
  sourceType: string;
  sourceRef: string | null;
  status: string;
  retryCount: number;
  errorMessage: string | null;
  supplierBillId: string | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
};

const QUEUE_STATUS_COLOR: Record<string, string> = {
  NEW:              "#888888",
  DOWNLOADED:       "#888888",
  OCR_REQUIRED:     "#FFCC00",
  PARSED:           "#00CCFF",
  MATCH_PENDING:    "#FF9900",
  AUTO_MATCHED:     "#00CC66",
  REVIEW_REQUIRED:  "#FF9900",
  APPROVED:         "#00CC66",
  POSTED:           "#00CC66",
  ERROR:            "#FF3333",
  DEAD_LETTER:      "#FF3333",
};

type QueueKpis = {
  docsIngested: number; billsIngested: number;
  totalLines: number; matchedLines: number; suggestedLines: number; unallocLines: number;
  autoMatchRate: number; reviewRate: number; unallocRate: number;
  duplicateBills: number;
  suppliers: Array<{ supplier: string; bills: number; lines: number; matched: number; suggested: number; unallocated: number; totalCost: number; matchPct: number }>;
};

function IntakeQueueTab() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<QueueDoc[]>([]);
  const [kpis, setKpis] = useState<QueueKpis | null>(null);
  const [loading, setLoading] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [tickResult, setTickResult] = useState<string | null>(null);
  const [drillDownId, setDrillDownId] = useState<string | null>(null);
  const [drillDownData, setDrillDownData] = useState<unknown>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/intake/queue");
      const j = await r.json();
      setCounts(j.counts ?? {});
      setRecent(j.recent ?? []);
      setKpis(j.kpis ?? null);
    } finally { setLoading(false); }
  }

  async function tick() {
    setTicking(true);
    setTickResult(null);
    try {
      const r = await fetch("/api/intake/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      const j = await r.json();
      setTickResult(JSON.stringify(j));
      await refresh();
    } catch (e) {
      setTickResult(e instanceof Error ? e.message : "tick failed");
    } finally { setTicking(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function openDoc(id: string) {
    if (drillDownId === id) { setDrillDownId(null); setDrillDownData(null); return; }
    setDrillDownId(id);
    setDrillLoading(true);
    try {
      const r = await fetch(`/api/intake/documents/${id}`);
      const j = await r.json();
      setDrillDownData(j);
    } finally { setDrillLoading(false); }
  }

  const totalDocs = Object.values(counts).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-4">
      <div className="border border-[#333333] bg-[#0F0F0F] p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Bills Intake Engine</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: "#FF6600" }}>
              {totalDocs} documents in pipeline
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              {loading ? "..." : "↻ Refresh"}
            </Button>
            <Button size="sm" variant="default" onClick={tick} disabled={ticking}>
              {ticking ? "Running..." : "▶ Run Pipeline"}
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={async () => {
                setTickResult("Re-matching all unmatched lines…");
                const r = await fetch("/api/intake/rematch-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
                const j = await r.json();
                setTickResult(`Re-match: scanned ${j.scanned}, auto ${j.autoLinked}, suggested ${j.suggested}, miss ${j.noMatch}, err ${j.errors}`);
                await refresh();
              }}
            >
              ⟳ Re-match all bills
            </Button>
            <Button
              size="sm" variant="outline"
              onClick={async () => {
                if (!confirm("Auto-approve all SUGGESTED lines whose top match scores ≥90 overall AND ≥80 product confidence?")) return;
                setTickResult("Bulk approving high-confidence suggestions…");
                const r = await fetch("/api/intake/bulk-approve", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ minOverall: 90, minProduct: 80 }),
                });
                const j = await r.json();
                setTickResult(`Bulk approve: eligible ${j.eligible}, approved ${j.approved}, skipped ${j.skipped}, err ${j.errors}`);
                await refresh();
              }}
              title="Auto-approve every SUGGESTED line with top match ≥90 overall + ≥80 product confidence"
            >
              ⚡ Bulk approve (≥90)
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-11 gap-2">
          {Object.entries(counts).map(([status, n]) => (
            <div key={status} className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate" title={status}>
                {status.replace("_", " ")}
              </div>
              <div className="text-lg font-medium tabular-nums" style={{ color: QUEUE_STATUS_COLOR[status] ?? "#888" }}>
                {n}
              </div>
            </div>
          ))}
        </div>
        {tickResult && (
          <div className="mt-3 text-xs text-muted-foreground font-mono break-all">
            ▸ {tickResult}
          </div>
        )}
      </div>

      {/* KPIs — match quality + supplier performance */}
      {kpis && kpis.totalLines > 0 && (
        <div className="border border-[#333333] bg-[#0F0F0F] p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Auto-match rate</div>
              <div className="text-2xl font-medium tabular-nums" style={{ color: kpis.autoMatchRate >= 60 ? "#00CC66" : kpis.autoMatchRate >= 30 ? "#FF9900" : "#FF3333" }}>
                {kpis.autoMatchRate}%
              </div>
              <div className="text-[10px] text-muted-foreground">{kpis.matchedLines} / {kpis.totalLines} lines</div>
            </div>
            <div className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Review queue</div>
              <div className="text-2xl font-medium tabular-nums" style={{ color: "#FF9900" }}>
                {kpis.reviewRate}%
              </div>
              <div className="text-[10px] text-muted-foreground">{kpis.suggestedLines} suggested</div>
            </div>
            <div className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Unallocated</div>
              <div className="text-2xl font-medium tabular-nums" style={{ color: kpis.unallocRate <= 10 ? "#00CC66" : kpis.unallocRate <= 30 ? "#FF9900" : "#FF3333" }}>
                {kpis.unallocRate}%
              </div>
              <div className="text-[10px] text-muted-foreground">{kpis.unallocLines} no destination</div>
            </div>
            <div className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Duplicates flagged</div>
              <div className="text-2xl font-medium tabular-nums" style={{ color: kpis.duplicateBills > 0 ? "#FF3333" : "#00CC66" }}>
                {kpis.duplicateBills}
              </div>
              <div className="text-[10px] text-muted-foreground">across {kpis.billsIngested} bills</div>
            </div>
          </div>

          {/* Per-supplier match quality */}
          {kpis.suppliers.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Supplier match quality</div>
              <div className="border border-[#333333]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead className="text-right">Bills</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Matched</TableHead>
                      <TableHead className="text-right">Suggested</TableHead>
                      <TableHead className="text-right">Unalloc</TableHead>
                      <TableHead className="text-right">Match %</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kpis.suppliers.map((s) => (
                      <TableRow key={s.supplier}>
                        <TableCell>{s.supplier}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.bills}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.lines}</TableCell>
                        <TableCell className="text-right tabular-nums" style={{ color: "#00CC66" }}>{s.matched}</TableCell>
                        <TableCell className="text-right tabular-nums" style={{ color: "#FF9900" }}>{s.suggested}</TableCell>
                        <TableCell className="text-right tabular-nums" style={{ color: s.unallocated > 0 ? "#FF3333" : "#888" }}>{s.unallocated}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium" style={{ color: s.matchPct >= 80 ? "#00CC66" : s.matchPct >= 50 ? "#FF9900" : "#FF3333" }}>
                          {s.matchPct}%
                        </TableCell>
                        <TableCell className="text-right tabular-nums">£{s.totalCost.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      <LearningHistoryPanel />

      <div className="border border-[#333333] bg-[#1A1A1A]">
        {recent.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No documents in the queue yet. Drop a PDF or wait for the email poller.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Retries</TableHead>
                <TableHead>Last Attempt</TableHead>
                <TableHead>Bill</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((d) => (
                <React.Fragment key={d.id}>
                  <TableRow className="cursor-pointer hover:bg-[#222]" onClick={() => openDoc(d.id)}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      <span className="mr-1">{drillDownId === d.id ? "▾" : "▸"}</span>
                      {new Date(d.createdAt).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className="text-xs">{d.sourceType}</TableCell>
                    <TableCell className="text-xs max-w-[20ch] truncate" title={d.sourceRef ?? ""}>
                      {d.sourceRef ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" style={{ color: QUEUE_STATUS_COLOR[d.status] ?? "#888" }}>
                        {d.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">
                      {d.retryCount}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {d.lastAttemptAt ? new Date(d.lastAttemptAt).toLocaleString("en-GB") : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {d.supplierBillId ? (
                        <span className="text-primary">→ bill</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-red-400 max-w-md truncate" title={d.errorMessage ?? ""}>
                      {d.errorMessage ?? "—"}
                    </TableCell>
                  </TableRow>
                  {drillDownId === d.id && (
                    <TableRow>
                      <TableCell colSpan={8} className="bg-[#0A0A0A] p-3">
                        {drillLoading ? (
                          <div className="text-xs text-muted-foreground">Loading…</div>
                        ) : (
                          <DocumentDrillDown data={drillDownData} />
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 6: Money on the Table
// ────────────────────────────────────────────────────────────────────────────

type MotableRow = {
  bucket: "UNINVOICED" | "DRAFT_ONLY" | "UNDER_INVOICED" | "UNALLOCATED" | "SUGGESTED_PENDING";
  billLineId: string;
  billId: string;
  billNo: string;
  billDate: string;
  supplier: string;
  description: string;
  cost: number;
  ticketId: string | null;
  ticketNo: number | null;
  ticketTitle: string | null;
  customer: string | null;
  site: string | null;
  invoiceNo: string | null;
  invoiceStatus: string | null;
  sale: number;
  gap: number; // money on the table for this row
  reason: string;
};

function buildMotable(bills: SupplierBill[]): MotableRow[] {
  const rows: MotableRow[] = [];
  for (const b of bills) {
    for (const line of b.lines) {
      const cost = Number(line.lineTotal ?? 0);
      if (cost <= 0) continue;

      // 1. UNALLOCATED — never matched to anything → cost we can't recover
      if (line.allocationStatus === "UNALLOCATED") {
        rows.push({
          bucket: "UNALLOCATED",
          billLineId: line.id, billId: b.id, billNo: b.billNo, billDate: b.billDate,
          supplier: b.supplier.name, description: line.description, cost,
          ticketId: null, ticketNo: null, ticketTitle: null, customer: null, site: null,
          invoiceNo: null, invoiceStatus: null, sale: 0, gap: cost,
          reason: "No ticket/customer assigned — cost has nowhere to land",
        });
        continue;
      }

      // 2. SUGGESTED — auto-link found a candidate but it's awaiting approval
      if (line.allocationStatus === "SUGGESTED") {
        rows.push({
          bucket: "SUGGESTED_PENDING",
          billLineId: line.id, billId: b.id, billNo: b.billNo, billDate: b.billDate,
          supplier: b.supplier.name, description: line.description, cost,
          ticketId: line.ticket?.id ?? null,
          ticketNo: line.ticket?.ticketNo ?? null,
          ticketTitle: line.ticket?.title ?? null,
          customer: line.customer?.name ?? null,
          site: line.site?.siteName ?? null,
          invoiceNo: null, invoiceStatus: null, sale: 0, gap: cost,
          reason: "Suggested match awaiting your approval",
        });
        continue;
      }

      // 3. MATCHED — find linked invoice line(s) for this bill
      if (line.allocationStatus === "MATCHED") {
        // PATH 1: precise via CostAllocations
        const caInv = (line.costAllocations ?? [])
          .flatMap((ca) => (ca.ticketLine?.invoiceLines ?? []).map((il) => ({
            invoiceNo: il.salesInvoice.invoiceNo,
            status: il.salesInvoice.status,
            sale: Number(il.lineTotal ?? 0),
          })));

        // PATH 2 fallback: SKU match in ticket.invoices.lines
        const skuMatch = (line.description || "").match(/^([A-Z][A-Z0-9./-]{2,})/);
        const billSku = skuMatch?.[1].toUpperCase();
        const fbInv = billSku
          ? (line.ticket?.invoices ?? []).flatMap((inv) =>
              inv.lines
                .filter((il) => (il.description || "").toUpperCase().includes(billSku))
                .map((il) => ({ invoiceNo: inv.invoiceNo, status: inv.status, sale: Number(il.lineTotal ?? 0) }))
            )
          : [];

        const invs = caInv.length > 0 ? caInv : fbInv;
        const totalSale = invs.reduce((s, x) => s + x.sale, 0);

        if (invs.length === 0) {
          // Cost incurred, ticket assigned, but NO invoice line backs it → uninvoiced cost
          rows.push({
            bucket: "UNINVOICED",
            billLineId: line.id, billId: b.id, billNo: b.billNo, billDate: b.billDate,
            supplier: b.supplier.name, description: line.description, cost,
            ticketId: line.ticket?.id ?? null,
            ticketNo: line.ticket?.ticketNo ?? null,
            ticketTitle: line.ticket?.title ?? null,
            customer: line.customer?.name ?? null,
            site: line.site?.siteName ?? null,
            invoiceNo: null, invoiceStatus: null, sale: 0, gap: cost,
            reason: "Cost on ticket but no invoice line yet — bill the customer for this item",
          });
          continue;
        }

        const onlyDrafts = invs.every((i) => i.status === "DRAFT");
        if (onlyDrafts) {
          rows.push({
            bucket: "DRAFT_ONLY",
            billLineId: line.id, billId: b.id, billNo: b.billNo, billDate: b.billDate,
            supplier: b.supplier.name, description: line.description, cost,
            ticketId: line.ticket?.id ?? null,
            ticketNo: line.ticket?.ticketNo ?? null,
            ticketTitle: line.ticket?.title ?? null,
            customer: line.customer?.name ?? null,
            site: line.site?.siteName ?? null,
            invoiceNo: invs.map((i) => i.invoiceNo).join(", "),
            invoiceStatus: "DRAFT", sale: totalSale, gap: totalSale,
            reason: "Invoice exists in DRAFT — send it to recover cash",
          });
          continue;
        }

        // Sale exists but undercharges cost
        if (totalSale < cost) {
          rows.push({
            bucket: "UNDER_INVOICED",
            billLineId: line.id, billId: b.id, billNo: b.billNo, billDate: b.billDate,
            supplier: b.supplier.name, description: line.description, cost,
            ticketId: line.ticket?.id ?? null,
            ticketNo: line.ticket?.ticketNo ?? null,
            ticketTitle: line.ticket?.title ?? null,
            customer: line.customer?.name ?? null,
            site: line.site?.siteName ?? null,
            invoiceNo: invs.map((i) => i.invoiceNo).join(", "),
            invoiceStatus: invs[0]?.status ?? null,
            sale: totalSale, gap: cost - totalSale,
            reason: "Invoice undercharges cost — short by the gap amount",
          });
        }
      }
    }
  }
  return rows;
}

function MoneyOnTableTab({ bills }: { bills: SupplierBill[] }) {
  const rows = buildMotable(bills);
  const totalsByBucket = rows.reduce<Record<string, { count: number; gap: number }>>((acc, r) => {
    acc[r.bucket] = acc[r.bucket] ?? { count: 0, gap: 0 };
    acc[r.bucket].count += 1;
    acc[r.bucket].gap   += r.gap;
    return acc;
  }, {});
  const grandTotal = rows.reduce((s, r) => s + r.gap, 0);

  const bucketLabel: Record<string, string> = {
    UNINVOICED:        "Uninvoiced cost (cost on ticket, no invoice line)",
    DRAFT_ONLY:        "Draft invoice — send to collect",
    UNDER_INVOICED:    "Under-invoiced — invoice < cost",
    SUGGESTED_PENDING: "Suggested match awaiting approval",
    UNALLOCATED:       "No ticket/customer assigned",
  };
  const bucketColor: Record<string, string> = {
    UNINVOICED:        "#FF6600",
    DRAFT_ONLY:        "#FFCC00",
    UNDER_INVOICED:    "#FF3333",
    SUGGESTED_PENDING: "#FF9900",
    UNALLOCATED:       "#888888",
  };

  return (
    <div className="space-y-4">
      <div className="border border-[#333333] bg-[#0F0F0F] p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
          Total money on the table across {rows.length} bill lines
        </div>
        <div className="text-3xl font-bold tabular-nums" style={{ color: "#FF6600" }}>
          £{grandTotal.toFixed(2)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
          {Object.entries(totalsByBucket).map(([bucket, t]) => (
            <div key={bucket} className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {bucketLabel[bucket]}
              </div>
              <div className="text-lg font-medium tabular-nums" style={{ color: bucketColor[bucket] }}>
                £{t.gap.toFixed(2)}
              </div>
              <div className="text-[10px] text-muted-foreground">{t.count} lines</div>
            </div>
          ))}
        </div>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Nothing on the table — every bill line is fully invoiced 🎉</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bucket</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Bill #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Sale</TableHead>
                <TableHead className="text-right">On Table</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows
                .sort((a, b) => b.gap - a.gap)
                .map((r) => (
                  <TableRow key={r.billLineId}>
                    <TableCell>
                      <Badge variant="outline" style={{ color: bucketColor[r.bucket] }}>
                        {r.bucket.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {fmtDate(r.billDate)}
                    </TableCell>
                    <TableCell className="text-xs">{r.supplier}</TableCell>
                    <TableCell className="text-xs">{r.billNo}</TableCell>
                    <TableCell className="text-xs max-w-md truncate" title={r.description}>{r.description}</TableCell>
                    <TableCell className="text-xs">{r.customer ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.site ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.ticketId ? (
                        <a href={`/tickets/${r.ticketId}`} className="text-primary hover:underline">
                          #{r.ticketNo}
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.invoiceNo ? (
                        <span>
                          {r.invoiceNo}{r.invoiceStatus ? ` (${r.invoiceStatus})` : ""}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs">£{r.cost.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs">{r.sale > 0 ? `£${r.sale.toFixed(2)}` : "—"}</TableCell>
                    <TableCell
                      className="text-right tabular-nums text-xs font-medium"
                      style={{ color: bucketColor[r.bucket] }}
                    >
                      £{r.gap.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 1: Supplier Bills
// ────────────────────────────────────────────────────────────────────────────

function SupplierBillsTab({
  bills,
  suppliers,
}: {
  bills: SupplierBill[];
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [billLines, setBillLines] = useState([
    { description: "", qty: "1", unitCost: "0", lineTotal: "0" },
  ]);

  // PDF upload state
  const [parsing, setParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setParseMessage("Only PDF files are supported.");
      return;
    }

    setParsing(true);
    setParseMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/supplier-bills/parse-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setParseMessage(data.error || "Failed to parse PDF.");
        return;
      }

      const { parsed } = data;
      if (!parsed) {
        setParseMessage("Could not extract data from PDF.");
        return;
      }

      // Auto-fill form fields from parsed data
      const form = document.querySelector<HTMLFormElement>(
        'form[data-bill-form]'
      );
      if (form) {
        if (parsed.billNo) {
          const billNoInput = form.querySelector<HTMLInputElement>('#billNo');
          if (billNoInput) {
            // Set value via native setter to trigger React state
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            nativeInputValueSetter?.call(billNoInput, parsed.billNo);
            billNoInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (parsed.billDate) {
          const dateInput = form.querySelector<HTMLInputElement>('#billDate');
          if (dateInput) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            nativeInputValueSetter?.call(dateInput, parsed.billDate);
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (parsed.grandTotal !== null) {
          const totalInput = form.querySelector<HTMLInputElement>('#totalCost');
          if (totalInput) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            nativeInputValueSetter?.call(totalInput, String(parsed.grandTotal));
            totalInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }

      // Auto-fill line items
      if (parsed.lines && parsed.lines.length > 0) {
        setBillLines(
          parsed.lines.map((l: { description: string; qty: number; unitCost: number; lineTotal: number }) => ({
            description: l.description,
            qty: String(l.qty),
            unitCost: String(l.unitCost),
            lineTotal: String(l.lineTotal),
          }))
        );
        setParseMessage(`Parsed ${parsed.lines.length} line${parsed.lines.length === 1 ? '' : 's'} from PDF.`);
      } else {
        setParseMessage(
          parsed.billNo
            ? "Extracted header info but no line items. Add lines manually."
            : "Could not extract structured data. Enter details manually."
        );
      }
    } catch {
      setParseMessage("Failed to upload PDF. Please try again.");
    } finally {
      setParsing(false);
      // Reset file input so re-uploading the same file triggers change
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  function updateBillLine(
    idx: number,
    field: string,
    value: string
  ) {
    setBillLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "qty" || field === "unitCost") {
        const q = Number(next[idx].qty) || 0;
        const u = Number(next[idx].unitCost) || 0;
        next[idx].lineTotal = (q * u).toFixed(2);
      }
      return next;
    });
  }

  function addBillLine() {
    setBillLines((prev) => [
      ...prev,
      { description: "", qty: "1", unitCost: "0", lineTotal: "0" },
    ]);
  }

  function removeBillLine(idx: number) {
    setBillLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleImportBill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const body = {
      supplierId,
      billNo: fd.get("billNo") as string,
      billDate: fd.get("billDate") as string,
      siteRef: (fd.get("siteRef") as string) || undefined,
      customerRef: (fd.get("customerRef") as string) || undefined,
      totalCost: Number(fd.get("totalCost")) || 0,
      lines: billLines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description,
          qty: Number(l.qty) || 1,
          unitCost: Number(l.unitCost) || 0,
          lineTotal: Number(l.lineTotal) || 0,
          allocationStatus: "UNALLOCATED",
        })),
    };

    try {
      const res = await fetch("/api/supplier-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.reset();
        setSupplierId("");
        setBillLines([
          { description: "", qty: "1", unitCost: "0", lineTotal: "0" },
        ]);
        setParseMessage(null);
        setSheetOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function allocationSummary(lines: SupplierBillLine[]): string {
    const matched = lines.filter(
      (l) => l.allocationStatus === "MATCHED"
    ).length;
    return `${matched}/${lines.length} matched`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Supplier Bills</h2>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Import Bill
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Import Supplier Bill</SheetTitle>
              <SheetDescription>
                Create a new supplier bill with line items.
              </SheetDescription>
            </SheetHeader>
            <form
              data-bill-form
              onSubmit={handleImportBill}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              {/* ── PDF Upload Zone ── */}
              <div
                className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handlePdfUpload(file);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfUpload(file);
                  }}
                />
                {parsing ? (
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Parsing PDF...
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full flex flex-col items-center gap-1.5 py-1 cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Drop a supplier bill PDF here, or click to browse
                    </span>
                  </button>
                )}
                {parseMessage && (
                  <p className={`text-xs mt-2 ${
                    parseMessage.startsWith("Parsed")
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}>
                    {parseMessage}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Supplier *</Label>
                <Select
                  value={supplierId}
                  onValueChange={(v) => setSupplierId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billNo">Bill No *</Label>
                <Input id="billNo" name="billNo" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billDate">Bill Date *</Label>
                <Input id="billDate" name="billDate" type="date" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="siteRef">Site Ref</Label>
                  <Input id="siteRef" name="siteRef" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customerRef">Customer Ref</Label>
                  <Input id="customerRef" name="customerRef" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totalCost">Total Cost *</Label>
                <Input
                  id="totalCost"
                  name="totalCost"
                  type="number"
                  step="0.01"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addBillLine}
                  >
                    <Plus className="size-3 mr-1" />
                    Add Line
                  </Button>
                </div>
                {billLines.map((line, idx) => (
                  <div
                    key={idx}
                    className="rounded border p-3 space-y-2 relative"
                  >
                    {billLines.length > 1 && (
                      <button
                        type="button"
                        className="absolute top-1 right-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => removeBillLine(idx)}
                      >
                        Remove
                      </button>
                    )}
                    <Input
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) =>
                        updateBillLine(idx, "description", e.target.value)
                      }
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        placeholder="Qty"
                        type="number"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) =>
                          updateBillLine(idx, "qty", e.target.value)
                        }
                      />
                      <Input
                        placeholder="Unit Cost"
                        type="number"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(e) =>
                          updateBillLine(idx, "unitCost", e.target.value)
                        }
                      />
                      <Input
                        placeholder="Line Total"
                        type="number"
                        step="0.01"
                        value={line.lineTotal}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <SheetFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Importing..." : "Import Bill"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <div className=" border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Bill No</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Bill Date</TableHead>
              <TableHead>Site Ref</TableHead>
              <TableHead>Customer Ref</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Allocation</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-center py-8 text-muted-foreground"
                >
                  No supplier bills yet.
                </TableCell>
              </TableRow>
            ) : (
              bills.map((bill) => (
                <React.Fragment key={bill.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedBill(
                        expandedBill === bill.id ? null : bill.id
                      )
                    }
                  >
                    <TableCell>
                      {expandedBill === bill.id ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{bill.billNo}</span>
                        {bill.duplicateStatus === "DEFINITE" && (
                          <Badge variant="destructive" className="text-[9px] h-4">
                            DUPLICATE{bill.duplicateOf ? ` of ${bill.duplicateOf.billNo}` : ""}
                          </Badge>
                        )}
                        {bill.duplicateStatus === "POSSIBLE" && (
                          <Badge variant="outline" className="text-[9px] h-4 text-amber-400 border-amber-700/60">
                            POSSIBLE DUP{bill.duplicateOf ? ` of ${bill.duplicateOf.billNo}` : ""}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{bill.supplier.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDate(bill.billDate)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(() => {
                        const sites = Array.from(new Map(bill.lines.filter((l) => l.site).map((l) => [l.site!.id, l.site!])).values());
                        if (sites.length === 0) return <span className="text-muted-foreground">{bill.siteRef || "\u2014"}</span>;
                        if (sites.length === 1) return <a href={`/sites/${sites[0].id}`} className="text-primary hover:underline">{sites[0].siteName}</a>;
                        return <span className="text-muted-foreground">{sites.length} sites</span>;
                      })()}
                    </TableCell>
                    <TableCell className="text-xs">
                      {(() => {
                        const customers = Array.from(new Map(bill.lines.filter((l) => l.customer).map((l) => [l.customer!.id, l.customer!])).values());
                        if (customers.length === 0) return <span className="text-muted-foreground">{bill.customerRef || "\u2014"}</span>;
                        if (customers.length === 1) return <span>{customers[0].name}</span>;
                        return <span className="text-muted-foreground">{customers.length} customers</span>;
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{bill.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(bill.totalCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {bill._count.lines}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {allocationSummary(bill.lines)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/30 border-[#333333]"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete bill ${bill.billNo}?`)) return;
                          const res = await fetch(`/api/supplier-bills/${bill.id}`, { method: "DELETE" });
                          if (res.ok) {
                            router.refresh();
                          } else {
                            const err = await res.json().catch(() => null);
                            alert(err?.error || "Failed to delete bill");
                          }
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedBill === bill.id && bill.lines.length > 0 && (
                    <TableRow key={`${bill.id}-lines`}>
                      <TableCell colSpan={10} className="p-0">
                        <div className="bg-muted/30 px-8 py-3">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Unit Cost</TableHead>
                                <TableHead className="text-right">Line Total</TableHead>
                                <TableHead>Classification</TableHead>
                                <TableHead>Allocation</TableHead>
                                <TableHead>Matched To</TableHead>
                                <TableHead>Invoice</TableHead>
                                <TableHead className="text-right">Sale</TableHead>
                                <TableHead className="text-right">PNL</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {bill.lines.map((line) => (
                                <TableRow key={line.id}>
                                  <TableCell className="font-medium">
                                    <div className="flex items-start gap-2">
                                      <span>{line.description}</span>
                                      {line.billLineMatches && line.billLineMatches.length > 0 && (
                                        <ConfidenceBreakdown matches={line.billLineMatches} />
                                      )}
                                    </div>
                                    {line.billLineAllocations && line.billLineAllocations.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {line.billLineAllocations.map((a) => (
                                          <Badge
                                            key={a.id}
                                            variant="outline"
                                            className="text-[10px] gap-1"
                                            style={{
                                              borderColor:
                                                a.allocationType === "TICKET_LINE" ? "#00CC66" :
                                                a.allocationType === "STOCK" ? "#00CCFF" :
                                                a.allocationType === "RETURNS_CANDIDATE" ? "#FF9900" :
                                                a.allocationType === "OVERHEAD" ? "#888888" : "#FF3333",
                                            }}
                                            title={a.reason ?? ""}
                                          >
                                            <span style={{
                                              color:
                                                a.allocationType === "TICKET_LINE" ? "#00CC66" :
                                                a.allocationType === "STOCK" ? "#00CCFF" :
                                                a.allocationType === "RETURNS_CANDIDATE" ? "#FF9900" :
                                                a.allocationType === "OVERHEAD" ? "#888888" : "#FF3333",
                                            }}>
                                              {Number(a.qtyAllocated).toFixed(2)} →
                                            </span>
                                            {a.allocationType === "TICKET_LINE" && a.ticketLine ? (
                                              <a
                                                href={`/tickets/${a.ticketLine.ticket.id}`}
                                                className="hover:underline"
                                              >
                                                #{a.ticketLine.ticket.ticketNo}
                                              </a>
                                            ) : (
                                              <span>{a.allocationType.replace("_", " ")}</span>
                                            )}
                                            <span className="text-muted-foreground">£{Number(a.costAllocated).toFixed(2)}</span>
                                          </Badge>
                                        ))}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {dec(line.qty)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {dec(line.unitCost)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {dec(line.lineTotal)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={classificationVariant(line.costClassification)}>
                                      {line.costClassification}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={statusVariant(line.allocationStatus)}>
                                      {line.allocationStatus}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    <SuggestedMatchCell line={line} onChange={() => router.refresh()} />
                                  </TableCell>
                                  {(() => {
                                    // PATH 1 (precise): walk costAllocations → ticketLine → invoiceLine
                                    const caInvLines = (line.costAllocations ?? [])
                                      .flatMap((ca) =>
                                        (ca.ticketLine?.invoiceLines ?? []).map((il) => ({
                                          ...il,
                                          invoice: il.salesInvoice,
                                        }))
                                      );

                                    // PATH 2 (fallback): walk ticket.invoices.lines and match by SKU or token overlap
                                    const skuMatch = (line.description || "").match(/^([A-Z][A-Z0-9./-]{2,})/);
                                    const billSku = skuMatch ? skuMatch[1].toUpperCase() : "";
                                    const fallbackInvLines = (line.ticket?.invoices ?? [])
                                      .flatMap((inv) =>
                                        inv.lines
                                          .filter((il) => {
                                            if (!billSku) return false;
                                            return (il.description || "").toUpperCase().includes(billSku);
                                          })
                                          .map((il) => ({ ...il, invoice: { id: inv.id, invoiceNo: inv.invoiceNo, status: inv.status } }))
                                      );

                                    const invLines = caInvLines.length > 0 ? caInvLines : fallbackInvLines;
                                    const totalSale = invLines.reduce((s, il) => s + Number(il.lineTotal ?? 0), 0);
                                    const cost = Number(line.lineTotal ?? 0);
                                    const pnl  = totalSale - cost;
                                    const uniqueInvoices = Array.from(
                                      new Map(invLines.map((il) => [il.invoice.id, il.invoice])).values()
                                    );
                                    return (
                                      <>
                                        <TableCell className="text-xs">
                                          {uniqueInvoices.length === 0 ? (
                                            <span className="text-muted-foreground">—</span>
                                          ) : (
                                            <div className="space-y-0.5">
                                              {uniqueInvoices.map((inv) => (
                                                <div key={inv.id}>
                                                  <a
                                                    href={`/invoices?focus=${inv.id}`}
                                                    className="text-primary hover:underline"
                                                  >
                                                    {inv.invoiceNo}
                                                  </a>
                                                  <span className="text-muted-foreground"> · {inv.status}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </TableCell>
                                        <TableCell className="text-right tabular-nums text-xs">
                                          {totalSale > 0 ? totalSale.toFixed(2) : "—"}
                                        </TableCell>
                                        <TableCell
                                          className="text-right tabular-nums text-xs font-medium"
                                          style={{
                                            color:
                                              totalSale === 0 ? undefined : pnl >= 0 ? "#00CC66" : "#FF4444",
                                          }}
                                        >
                                          {totalSale > 0 ? pnl.toFixed(2) : "—"}
                                        </TableCell>
                                      </>
                                    );
                                  })()}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 2: Cost Allocations
// ────────────────────────────────────────────────────────────────────────────

function CostAllocationsTab({
  unresolvedAllocations,
  supplierBills,
  tickets,
}: {
  unresolvedAllocations: CostAllocationItem[];
  supplierBills: SupplierBill[];
  tickets: TicketOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedBillLineId, setSelectedBillLineId] = useState("");
  const [ticketLineId, setTicketLineId] = useState("");

  // Collect all unresolved bill lines across all bills
  const unresolvedBillLines = supplierBills.flatMap((b) =>
    b.lines
      .filter((l) => l.allocationStatus !== "MATCHED")
      .map((l) => ({
        ...l,
        supplierName: b.supplier.name,
        billNo: b.billNo,
      }))
  );

  // Collect all ticket line IDs from allocations to show in form
  const ticketLineOptions = unresolvedAllocations.map((a) => ({
    id: a.ticketLine.id,
    description: a.ticketLine.description,
  }));

  // Deduplicate
  const uniqueTicketLines = Array.from(
    new Map(ticketLineOptions.map((t) => [t.id, t])).values()
  );

  async function handleAllocate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      ticketLineId,
      supplierBillLineId: selectedBillLineId,
      qtyAllocated: Number(fd.get("qtyAllocated")) || 0,
      unitCost: Number(fd.get("unitCost")) || 0,
      totalCost: Number(fd.get("totalCost")) || 0,
      notes: (fd.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch("/api/cost-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        setSelectedBillLineId("");
        setTicketLineId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Unresolved Cost Lines */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Unresolved Cost Lines</h2>
        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Bill No</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {unresolvedBillLines.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    All cost lines are matched.
                  </TableCell>
                </TableRow>
              ) : (
                unresolvedBillLines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {line.description}
                    </TableCell>
                    <TableCell>{line.supplierName}</TableCell>
                    <TableCell>{line.billNo}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(line.qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(line.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(line.lineTotal)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={classificationVariant(
                          line.costClassification
                        )}
                      >
                        {line.costClassification}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant(line.allocationStatus)}
                      >
                        {line.allocationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Dialog
                        open={dialogOpen && selectedBillLineId === line.id}
                        onOpenChange={(open) => {
                          setDialogOpen(open);
                          if (open) setSelectedBillLineId(line.id);
                        }}
                      >
                        <DialogTrigger
                          render={
                            <Button variant="outline" size="sm">
                              Allocate
                            </Button>
                          }
                        />
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Allocate Cost Line</DialogTitle>
                            <DialogDescription>
                              Allocate &quot;{line.description}&quot; to a ticket
                              line.
                            </DialogDescription>
                          </DialogHeader>
                          <form onSubmit={handleAllocate} className="space-y-4">
                            <div className="space-y-1.5">
                              <Label>Ticket Line *</Label>
                              <Select
                                value={ticketLineId}
                                onValueChange={(v) =>
                                  setTicketLineId(v ?? "")
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select ticket line" />
                                </SelectTrigger>
                                <SelectContent>
                                  {uniqueTicketLines.map((tl) => (
                                    <SelectItem key={tl.id} value={tl.id}>
                                      {tl.description}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <Label htmlFor="qtyAllocated">Qty</Label>
                                <Input
                                  id="qtyAllocated"
                                  name="qtyAllocated"
                                  type="number"
                                  step="0.01"
                                  defaultValue={Number(
                                    line.qty?.toString() ?? "0"
                                  )}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="unitCost">Unit Cost</Label>
                                <Input
                                  id="unitCost"
                                  name="unitCost"
                                  type="number"
                                  step="0.01"
                                  defaultValue={Number(
                                    line.unitCost?.toString() ?? "0"
                                  )}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="totalCost">Total</Label>
                                <Input
                                  id="totalCost"
                                  name="totalCost"
                                  type="number"
                                  step="0.01"
                                  defaultValue={Number(
                                    line.lineTotal?.toString() ?? "0"
                                  )}
                                />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="alloc-notes">Notes</Label>
                              <Textarea
                                id="alloc-notes"
                                name="notes"
                                rows={2}
                              />
                            </div>
                            <DialogFooter>
                              <Button type="submit" disabled={submitting}>
                                {submitting ? "Allocating..." : "Allocate"}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Recent Allocations */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Recent Allocations</h2>
        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket Line</TableHead>
                <TableHead>Bill Line</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unresolvedAllocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No unresolved allocations.
                  </TableCell>
                </TableRow>
              ) : (
                unresolvedAllocations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {a.ticketLine.description}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {a.supplierBillLine.description}
                    </TableCell>
                    <TableCell>
                      {a.supplierBillLine.supplierBill.billNo}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(a.qtyAllocated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(a.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(a.totalCost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(a.allocationStatus)}>
                        {a.allocationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.confidenceScore
                        ? `${Number(a.confidenceScore.toString())}%`
                        : "\u2014"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 3: Absorbed Costs
// ────────────────────────────────────────────────────────────────────────────

function AbsorbedCostsTab({
  absorbedCosts,
  tickets,
}: {
  absorbedCosts: AbsorbedCostItem[];
  tickets: TicketOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState("");

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      supplierBillLineId: fd.get("supplierBillLineId") as string,
      ticketId,
      ticketLineId: (fd.get("ticketLineId") as string) || undefined,
      description: fd.get("description") as string,
      amount: Number(fd.get("amount")) || 0,
      allocationBasis: (fd.get("allocationBasis") as string) || undefined,
    };

    try {
      const res = await fetch("/api/absorbed-cost-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        setTicketId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Absorbed Costs</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Add Absorbed Cost
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Absorbed Cost</DialogTitle>
              <DialogDescription>
                Record an absorbed cost allocation.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="abs-billLineId">Supplier Bill Line ID *</Label>
                <Input
                  id="abs-billLineId"
                  name="supplierBillLineId"
                  required
                  placeholder="Paste supplier bill line ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ticket *</Label>
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
              <div className="space-y-1.5">
                <Label htmlFor="abs-ticketLineId">Ticket Line ID</Label>
                <Input
                  id="abs-ticketLineId"
                  name="ticketLineId"
                  placeholder="Optional ticket line ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="abs-description">Description *</Label>
                <Input
                  id="abs-description"
                  name="description"
                  required
                  placeholder="e.g. MOQ surplus on fixings"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="abs-amount">Amount *</Label>
                  <Input
                    id="abs-amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="abs-basis">Allocation Basis</Label>
                  <Input
                    id="abs-basis"
                    name="allocationBasis"
                    placeholder="e.g. PRO_RATA"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Adding..." : "Add Absorbed Cost"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className=" border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Supplier Bill Line</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Allocation Basis</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {absorbedCosts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-8 text-muted-foreground"
                >
                  No absorbed costs recorded.
                </TableCell>
              </TableRow>
            ) : (
              absorbedCosts.map((ac) => (
                <TableRow key={ac.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {ac.description}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {ac.supplierBillLine.description}
                  </TableCell>
                  <TableCell>{ac.ticket.title}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {dec(ac.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ac.allocationBasis || "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {fmtDate(ac.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 4: Returns & Credits
// ────────────────────────────────────────────────────────────────────────────

function ReturnsTab({
  returns,
  suppliers,
  tickets,
}: {
  returns: ReturnItem[];
  suppliers: SupplierOption[];
  tickets: TicketOption[];
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [returnLines, setReturnLines] = useState([
    { ticketLineId: "", qtyReturned: "1", expectedCredit: "0" },
  ]);

  function updateReturnLine(idx: number, field: string, value: string) {
    setReturnLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addReturnLine() {
    setReturnLines((prev) => [
      ...prev,
      { ticketLineId: "", qtyReturned: "1", expectedCredit: "0" },
    ]);
  }

  function removeReturnLine(idx: number) {
    setReturnLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCreateReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      ticketId,
      supplierId,
      returnDate: fd.get("returnDate") as string,
      notes: (fd.get("notes") as string) || undefined,
      lines: returnLines
        .filter((l) => l.ticketLineId.trim())
        .map((l) => ({
          ticketLineId: l.ticketLineId,
          qtyReturned: Number(l.qtyReturned) || 0,
          expectedCredit: Number(l.expectedCredit) || 0,
        })),
    };

    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSheetOpen(false);
        setTicketId("");
        setSupplierId("");
        setReturnLines([
          { ticketLineId: "", qtyReturned: "1", expectedCredit: "0" },
        ]);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function totalExpectedCredit(lines: ReturnLineItem[]): number {
    return lines.reduce(
      (sum, l) => sum + Number(l.expectedCredit?.toString() ?? 0),
      0
    );
  }

  return (
    <div className="space-y-6">
      {/* Returns Candidates from the allocation engine — surplus the engine wants to send back */}
      <ReturnsCandidatesPanel />

      {/* Returns */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Returns</h2>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button size="sm">
                  <Plus className="size-4 mr-1" />
                  Create Return
                </Button>
              }
            />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Create Return</SheetTitle>
                <SheetDescription>
                  Record a supplier return with line items.
                </SheetDescription>
              </SheetHeader>
              <form
                onSubmit={handleCreateReturn}
                className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
              >
                <div className="space-y-1.5">
                  <Label>Ticket *</Label>
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
                <div className="space-y-1.5">
                  <Label>Supplier *</Label>
                  <Select
                    value={supplierId}
                    onValueChange={(v) => setSupplierId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="returnDate">Return Date *</Label>
                  <Input
                    id="returnDate"
                    name="returnDate"
                    type="date"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="return-notes">Notes</Label>
                  <Textarea id="return-notes" name="notes" rows={2} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addReturnLine}
                    >
                      <Plus className="size-3 mr-1" />
                      Add Line
                    </Button>
                  </div>
                  {returnLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="rounded border p-3 space-y-2 relative"
                    >
                      {returnLines.length > 1 && (
                        <button
                          type="button"
                          className="absolute top-1 right-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => removeReturnLine(idx)}
                        >
                          Remove
                        </button>
                      )}
                      <Input
                        placeholder="Ticket Line ID"
                        value={line.ticketLineId}
                        onChange={(e) =>
                          updateReturnLine(idx, "ticketLineId", e.target.value)
                        }
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Qty Returned"
                          type="number"
                          step="0.01"
                          value={line.qtyReturned}
                          onChange={(e) =>
                            updateReturnLine(
                              idx,
                              "qtyReturned",
                              e.target.value
                            )
                          }
                        />
                        <Input
                          placeholder="Expected Credit"
                          type="number"
                          step="0.01"
                          value={line.expectedCredit}
                          onChange={(e) =>
                            updateReturnLine(
                              idx,
                              "expectedCredit",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <SheetFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create Return"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>

        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Return Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Expected Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No returns recorded.
                  </TableCell>
                </TableRow>
              ) : (
                returns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.supplier.name}
                    </TableCell>
                    <TableCell>{r.ticket.title}</TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDate(r.returnDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.lines.length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(totalExpectedCredit(r.lines))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Credit Notes placeholder */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Credit Notes</h2>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Credit note management coming in detail later.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 5: MOQ / Stock / Reallocations
// ────────────────────────────────────────────────────────────────────────────

function StockTab({
  stockExcess,
  reallocations,
}: {
  stockExcess: StockExcessItem[];
  reallocations: ReallocationItem[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleReallocation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      fromTicketLineId: fd.get("fromTicketLineId") as string,
      toTicketLineId: fd.get("toTicketLineId") as string,
      amount: Number(fd.get("amount")) || 0,
      reason: (fd.get("reason") as string) || undefined,
    };

    try {
      const res = await fetch("/api/reallocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function treatmentVariant(
    t: string
  ): "default" | "secondary" | "outline" | "destructive" {
    switch (t) {
      case "WRITE_OFF":
        return "destructive";
      case "REALLOCATE":
        return "default";
      case "HOLD":
        return "secondary";
      default:
        return "outline";
    }
  }

  return (
    <div className="space-y-6">
      {/* Stock Excess Records */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Stock Excess Records</h2>
        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill Line</TableHead>
                <TableHead className="text-right">Purchased Cost</TableHead>
                <TableHead className="text-right">Used Cost</TableHead>
                <TableHead className="text-right">Excess Cost</TableHead>
                <TableHead>Treatment</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stockExcess.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No open stock excess records.
                  </TableCell>
                </TableRow>
              ) : (
                stockExcess.map((se) => (
                  <TableRow key={se.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {se.supplierBillLine?.description || se.description || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(se.purchasedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(se.usedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(se.excessCost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={treatmentVariant(se.treatment)}>
                        {se.treatment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{se.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Reallocations */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Reallocations</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <ArrowRightLeft className="size-4 mr-1" />
                  Create Reallocation
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Reallocation</DialogTitle>
                <DialogDescription>
                  Move cost from one ticket line to another.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleReallocation} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-from">From Ticket Line ID *</Label>
                  <Input
                    id="realloc-from"
                    name="fromTicketLineId"
                    required
                    placeholder="Paste ticket line ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-to">To Ticket Line ID *</Label>
                  <Input
                    id="realloc-to"
                    name="toTicketLineId"
                    required
                    placeholder="Paste ticket line ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-amount">Amount *</Label>
                  <Input
                    id="realloc-amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-reason">Reason</Label>
                  <Textarea id="realloc-reason" name="reason" rows={2} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create Reallocation"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From Ticket Line</TableHead>
                <TableHead>From Ticket</TableHead>
                <TableHead>To Ticket Line</TableHead>
                <TableHead>To Ticket</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reallocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No reallocations recorded.
                  </TableCell>
                </TableRow>
              ) : (
                reallocations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium max-w-[150px] truncate">
                      {r.fromTicketLine.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.fromTicketLine.ticket.title}
                    </TableCell>
                    <TableCell className="font-medium max-w-[150px] truncate">
                      {r.toTicketLine.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.toTicketLine.ticket.title}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(r.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[150px] truncate">
                      {r.reason || "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmtDate(r.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

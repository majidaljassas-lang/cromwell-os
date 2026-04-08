"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Eye,
  Zap,
  Plus,
  Ban,
  RefreshCw,
  Trash2,
  CheckCircle,
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface IngestionViewProps {
  inboxEvents: any[];
  siteMatches: any[];
  draftInvoices: any[];
  reconstructionBatches: any[];
  sources: any[];
  sites: { id: string; siteName: string }[];
  customers: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  tickets: { id: string; title: string }[];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtMoney(v: number | string | null | undefined) {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function confidenceColor(c: number | null | undefined) {
  if (c == null) return "text-[#666666]";
  if (c >= 80) return "text-[#00CC66]";
  if (c >= 60) return "text-[#FF9900]";
  return "text-[#FF3333]";
}

function sourceTypeBadge(st: string) {
  const colors: Record<string, string> = {
    WHATSAPP: "bg-[#00CC66]/20 text-[#00CC66] border-[#00CC66]/30",
    OUTLOOK: "bg-[#3399FF]/20 text-[#3399FF] border-[#3399FF]/30",
    EMAIL: "bg-[#3399FF]/20 text-[#3399FF] border-[#3399FF]/30",
    ZOHO_BOOKS: "bg-[#FF9900]/20 text-[#FF9900] border-[#FF9900]/30",
    PDF_UPLOAD: "bg-[#00CCCC]/20 text-[#00CCCC] border-[#00CCCC]/30",
    IMAGE_UPLOAD: "bg-[#00CCCC]/20 text-[#00CCCC] border-[#00CCCC]/30",
    MANUAL: "bg-[#888888]/20 text-[#888888] border-[#888888]/30",
    API: "bg-[#888888]/20 text-[#888888] border-[#888888]/30",
  };
  return (
    <span
      className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 border ${colors[st] || "bg-[#333333] text-[#888888] border-[#333333]"}`}
    >
      {st?.replace(/_/g, " ")}
    </span>
  );
}

function statusBadge(status: string, colorMap: Record<string, string>) {
  const c = colorMap[status] || "bg-[#333333] text-[#888888] border-[#333333]";
  return (
    <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 border ${c}`}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}

const DRAFT_STATUS_COLORS: Record<string, string> = {
  DRAFT_IMPORTED: "bg-[#FF9900]/20 text-[#FF9900] border-[#FF9900]/30",
  UNVERIFIED: "bg-[#FF3333]/20 text-[#FF3333] border-[#FF3333]/30",
  VERIFIED_READY: "bg-[#00CC66]/20 text-[#00CC66] border-[#00CC66]/30",
  REBUILT: "bg-[#3399FF]/20 text-[#3399FF] border-[#3399FF]/30",
  SUPERSEDED: "bg-[#666666]/20 text-[#666666] border-[#666666]/30",
  DISCARDED: "bg-[#444444]/20 text-[#444444] border-[#444444]/30",
};

const RECON_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-[#FF9900]/20 text-[#FF9900] border-[#FF9900]/30",
  PROCESSING: "bg-[#3399FF]/20 text-[#3399FF] border-[#3399FF]/30",
  REVIEW: "bg-[#FF6600]/20 text-[#FF6600] border-[#FF6600]/30",
  COMPLETED: "bg-[#00CC66]/20 text-[#00CC66] border-[#00CC66]/30",
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export function IngestionView({
  inboxEvents,
  siteMatches,
  draftInvoices,
  reconstructionBatches,
  sources,
  sites,
  tickets = [],
}: IngestionViewProps) {
  const router = useRouter();

  // ── Inbox state ──
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [minConf, setMinConf] = useState("");
  const [maxConf, setMaxConf] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [rawVisible, setRawVisible] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Site resolution state ──
  const [siteDialogOpen, setSiteDialogOpen] = useState<string | null>(null);
  const [createSiteDialogOpen, setCreateSiteDialogOpen] = useState<string | null>(null);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [newSiteName, setNewSiteName] = useState("");

  // ── Reconstruction state ──
  const [newBatchMonth, setNewBatchMonth] = useState("");
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);

  // ── Inbox filters ──
  const filteredEvents = inboxEvents.filter((ev) => {
    if (sourceFilter !== "ALL" && ev.source?.sourceType !== sourceFilter) return false;
    const pm = ev.parsedMessages?.[0];
    const conf = pm?.confidenceScore != null ? Number(pm.confidenceScore) : null;
    if (minConf && conf != null && conf < Number(minConf)) return false;
    if (maxConf && conf != null && conf > Number(maxConf)) return false;
    return true;
  });

  // ── Inbox stats ──
  const totalPending = inboxEvents.length;
  const highConf = inboxEvents.filter((ev) => {
    const c = ev.parsedMessages?.[0]?.confidenceScore;
    return c != null && Number(c) >= 80;
  }).length;
  const lowConf = inboxEvents.filter((ev) => {
    const c = ev.parsedMessages?.[0]?.confidenceScore;
    return c != null && Number(c) < 60;
  }).length;
  const unresolvedSites = siteMatches.length;

  function toggleExpand(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleRaw(id: string) {
    setRawVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function commercialise(eventId: string) {
    setActionLoading(eventId);
    try {
      await fetch(`/api/ingestion/commercialise/${eventId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", createEnquiry: true }),
      });
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function resolveSite(matchId: string, action: string, body: Record<string, any> = {}) {
    setActionLoading(matchId);
    try {
      await fetch(`/api/ingestion/review/site-resolution/${matchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      router.refresh();
    } finally {
      setActionLoading(null);
      setSiteDialogOpen(null);
      setCreateSiteDialogOpen(null);
      setSelectedSiteId("");
      setNewSiteName("");
    }
  }

  async function updateDraftStatus(id: string, status: string) {
    setActionLoading(id);
    try {
      await fetch(`/api/ingestion/draft-invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setActionLoading(null);
    }
  }

  async function createBatch() {
    if (!newBatchMonth) return;
    setActionLoading("new-batch");
    try {
      await fetch("/api/reconstruction/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monthYear: newBatchMonth }),
      });
      router.refresh();
    } finally {
      setActionLoading(null);
      setBatchDialogOpen(false);
      setNewBatchMonth("");
    }
  }

  return (
    <Tabs defaultValue="inbox">
      <TabsList
        className="bg-[#1A1A1A] border border-[#333333] p-0"
      >
        {[
          { value: "inbox", label: "INBOX", count: totalPending },
          { value: "site-resolution", label: "SITE RESOLUTION", count: unresolvedSites },
          { value: "draft-recovery", label: "DRAFT RECOVERY", count: draftInvoices.length },
          { value: "reconstruction", label: "RECONSTRUCTION", count: reconstructionBatches.length },
          { value: "sources", label: "SOURCES", count: sources.length },
        ].map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="text-[10px] font-bold tracking-wider uppercase text-[#888888] px-3 py-1.5 data-active:bg-[#FF6600] data-active:text-black hover:text-[#E0E0E0]"
          >
            {tab.label}
            <span className="ml-1.5 text-[9px] opacity-70">{tab.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* ── TAB 1: INBOX ─────────────────────────────────────────── */}
      <TabsContent value="inbox" className="space-y-3 mt-3">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "TOTAL PENDING", value: totalPending, color: "text-[#E0E0E0]" },
            { label: "HIGH CONFIDENCE", value: highConf, color: "text-[#00CC66]" },
            { label: "LOW CONFIDENCE", value: lowConf, color: "text-[#FF3333]" },
            { label: "UNRESOLVED SITES", value: unresolvedSites, color: "text-[#FF9900]" },
          ].map((card) => (
            <div key={card.label} className="bg-[#1A1A1A] border border-[#333333] p-3">
              <div className="text-[9px] uppercase tracking-wider font-bold text-[#888888]">
                {card.label}
              </div>
              <div className={`text-xl font-bold bb-mono mt-1 ${card.color}`}>
                {card.value}
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 bg-[#1A1A1A] border border-[#333333] p-2">
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-[#888888] uppercase tracking-wider">Source</Label>
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v ?? "ALL")}>
              <SelectTrigger className="h-7 w-36 bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#222222] border-[#333333]">
                <SelectItem value="ALL">All Sources</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="OUTLOOK">Outlook</SelectItem>
                <SelectItem value="ZOHO_BOOKS">Zoho Books</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="PDF_UPLOAD">PDF Upload</SelectItem>
                <SelectItem value="IMAGE_UPLOAD">Image Upload</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="API">API</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px] text-[#888888] uppercase tracking-wider">Conf.</Label>
            <Input
              type="number"
              placeholder="Min"
              value={minConf}
              onChange={(e) => setMinConf(e.target.value)}
              className="h-7 w-16 bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px]"
            />
            <span className="text-[#666666] text-[10px]">—</span>
            <Input
              type="number"
              placeholder="Max"
              value={maxConf}
              onChange={(e) => setMaxConf(e.target.value)}
              className="h-7 w-16 bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px]"
            />
          </div>
          <div className="ml-auto text-[10px] text-[#666666] bb-mono">
            {filteredEvents.length} / {totalPending} events
          </div>
        </div>

        {/* Inbox table */}
        <div className="border border-[#333333]">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#333333] hover:bg-transparent">
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider w-6" />
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Source</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Kind</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Summary</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Conf</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Site Guess</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Received</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Linked</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEvents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-[#666666] py-8 text-xs">
                    No inbox events
                  </TableCell>
                </TableRow>
              )}
              {filteredEvents.map((ev, idx) => {
                const pm = ev.parsedMessages?.[0];
                const conf = pm?.confidenceScore != null ? Number(pm.confidenceScore) : null;
                const hasLinks = pm?.ingestionLinks?.some((l: any) => l.linkStatus === "CONFIRMED");
                const siteMatch = ev.sourceSiteMatches?.[0];
                const isExpanded = expandedRows.has(ev.id);
                const isRawVisible = rawVisible.has(ev.id);

                return (
                  <React.Fragment key={ev.id}>
                    <TableRow
                      className={`border-b border-[#333333] hover:bg-[#222222] ${idx % 2 === 1 ? "bg-[#151515]" : "bg-[#1A1A1A]"}`}
                    >
                      <TableCell className="p-1">
                        <button onClick={() => toggleExpand(ev.id)} className="text-[#666666] hover:text-[#E0E0E0]">
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      </TableCell>
                      <TableCell className="text-[10px]">{sourceTypeBadge(ev.source?.sourceType)}</TableCell>
                      <TableCell className="text-[10px]">
                        {ev.eventKind && (
                          <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 border bg-[#333333]/50 text-[#00CCCC] border-[#00CCCC]/30">
                            {ev.eventKind}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px] text-[#E0E0E0] max-w-[240px] truncate">
                        {pm?.extractedText?.substring(0, 80) || "—"}
                        {pm?.extractedText?.length > 80 ? "..." : ""}
                      </TableCell>
                      <TableCell className={`text-[10px] bb-mono font-bold ${confidenceColor(conf)}`}>
                        {conf != null ? conf.toFixed(0) : "—"}
                      </TableCell>
                      <TableCell className="text-[10px] text-[#E0E0E0]">
                        {siteMatch?.matchedSite?.siteName || siteMatch?.rawSiteText || "—"}
                        {siteMatch?.confidenceScore != null && (
                          <span className={`ml-1 text-[9px] bb-mono ${confidenceColor(Number(siteMatch.confidenceScore))}`}>
                            {Number(siteMatch.confidenceScore).toFixed(0)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[10px]">
                        <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 border bg-[#FF9900]/20 text-[#FF9900] border-[#FF9900]/30">
                          {ev.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-[10px] text-[#888888] bb-mono">
                        {fmtDate(ev.receivedAt)}
                      </TableCell>
                      <TableCell className="text-center">
                        {hasLinks ? (
                          <Check className="h-3 w-3 text-[#00CC66] inline" />
                        ) : (
                          <X className="h-3 w-3 text-[#666666] inline" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            className="h-5 px-1.5 text-[9px] bg-[#FF6600] text-black hover:bg-[#FF9900] uppercase tracking-wider font-bold"
                            onClick={() => commercialise(ev.id)}
                            disabled={actionLoading === ev.id}
                          >
                            <Zap className="h-2.5 w-2.5 mr-0.5" />
                            {actionLoading === ev.id ? "..." : "Comm"}
                          </Button>
                          <Dialog>
                            <DialogTrigger render={
                              <Button variant="outline" className="h-5 px-1.5 text-[9px] border-[#3399FF]/30 text-[#3399FF] hover:bg-[#3399FF]/10 uppercase tracking-wider font-bold">
                                <Link2 className="h-2.5 w-2.5 mr-0.5" />
                                Link
                              </Button>
                            } />
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Link to Ticket</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                {tickets.map((t: any) => (
                                  <Button
                                    key={t.id}
                                    variant="outline"
                                    className="w-full justify-start text-left h-auto py-2 text-xs"
                                    onClick={async () => {
                                      await fetch(`/api/ingestion/events/${ev.id}/link`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ ticketId: t.id }),
                                      });
                                      router.refresh();
                                    }}
                                  >
                                    {t.title}
                                  </Button>
                                ))}
                              </div>
                            </DialogContent>
                          </Dialog>
                          <Button
                            variant="outline"
                            className="h-5 px-1.5 text-[9px] border-[#FF3333]/30 text-[#FF3333] hover:bg-[#FF3333]/10 uppercase tracking-wider font-bold"
                            onClick={async () => {
                              await fetch(`/api/ingestion/events/${ev.id}/link`, { method: "DELETE" });
                              router.refresh();
                            }}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                          <Button
                            variant="outline"
                            className="h-5 px-1.5 text-[9px] border-[#333333] text-[#888888] hover:bg-[#222222] hover:text-[#E0E0E0] uppercase tracking-wider font-bold"
                            onClick={() => toggleRaw(ev.id)}
                          >
                            <Eye className="h-2.5 w-2.5 mr-0.5" />
                            Raw
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {/* Raw payload panel */}
                    {isRawVisible && (
                      <TableRow key={`${ev.id}-raw`} className="bg-[#111111] border-b border-[#333333]">
                        <TableCell colSpan={10} className="p-2">
                          <pre className="text-[9px] text-[#888888] bb-mono overflow-x-auto max-h-48 whitespace-pre-wrap">
                            {JSON.stringify(ev.rawPayload, null, 2)}
                          </pre>
                        </TableCell>
                      </TableRow>
                    )}
                    {/* Expanded detail */}
                    {isExpanded && (
                      <TableRow key={`${ev.id}-detail`} className="bg-[#111111] border-b border-[#333333]">
                        <TableCell colSpan={10} className="p-3">
                          <div className="grid grid-cols-3 gap-4">
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-[#888888] mb-1">Parsed Entities</div>
                              <div className="text-[10px] text-[#E0E0E0] bb-mono">
                                {pm?.messageType && <div>Type: {pm.messageType}</div>}
                                {pm?.structuredData && typeof pm.structuredData === "object" && (
                                  <pre className="text-[9px] text-[#888888] mt-1 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                    {JSON.stringify(pm.structuredData, null, 2)}
                                  </pre>
                                )}
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-[#888888] mb-1">Monetary Values</div>
                              <div className="text-[10px] text-[#E0E0E0] bb-mono">
                                {pm?.structuredData?.amounts
                                  ? (pm.structuredData.amounts as any[]).map((a: any, i: number) => (
                                      <div key={i}>{fmtMoney(a.value)} — {a.label || "unlabelled"}</div>
                                    ))
                                  : <span className="text-[#666666]">None extracted</span>
                                }
                              </div>
                            </div>
                            <div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-[#888888] mb-1">Site Matches</div>
                              <div className="text-[10px] text-[#E0E0E0]">
                                {ev.sourceSiteMatches?.length > 0
                                  ? ev.sourceSiteMatches.map((sm: any) => (
                                      <div key={sm.id} className="flex items-center gap-1 mb-0.5">
                                        <span className="text-[#888888]">{sm.rawSiteText}</span>
                                        <span className="text-[#666666]">&rarr;</span>
                                        <span>{sm.matchedSite?.siteName || "unresolved"}</span>
                                        <span className={`text-[9px] bb-mono ${confidenceColor(Number(sm.confidenceScore))}`}>
                                          {sm.confidenceScore != null ? `${Number(sm.confidenceScore).toFixed(0)}%` : ""}
                                        </span>
                                      </div>
                                    ))
                                  : <span className="text-[#666666]">No site matches</span>
                                }
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* ── TAB 2: SITE RESOLUTION ───────────────────────────────── */}
      <TabsContent value="site-resolution" className="space-y-3 mt-3">
        <div className="text-xs font-bold uppercase tracking-widest text-[#888888] mb-2">
          Unresolved Site Matches
        </div>
        <div className="border border-[#333333]">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#333333] hover:bg-transparent">
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Raw Site Text</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Source</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Confidence</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Suggested Site</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Received</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteMatches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-[#666666] py-8 text-xs">
                    No unresolved site matches
                  </TableCell>
                </TableRow>
              )}
              {siteMatches.map((sm, idx) => (
                <TableRow
                  key={sm.id}
                  className={`border-b border-[#333333] hover:bg-[#222222] ${idx % 2 === 1 ? "bg-[#151515]" : "bg-[#1A1A1A]"}`}
                >
                  <TableCell className="text-[10px] text-[#E0E0E0] font-bold bb-mono">
                    {sm.rawSiteText}
                  </TableCell>
                  <TableCell className="text-[10px]">
                    {sm.ingestionEvent?.source?.sourceType
                      ? sourceTypeBadge(sm.ingestionEvent.source.sourceType)
                      : "—"}
                  </TableCell>
                  <TableCell className={`text-[10px] bb-mono font-bold ${confidenceColor(sm.confidenceScore != null ? Number(sm.confidenceScore) : null)}`}>
                    {sm.confidenceScore != null ? `${Number(sm.confidenceScore).toFixed(0)}%` : "—"}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#E0E0E0]">
                    {sm.matchedSite ? (
                      <div className="flex items-center gap-1">
                        <span>{sm.matchedSite.siteName}</span>
                        <span className={`text-[9px] bb-mono ${confidenceColor(sm.confidenceScore != null ? Number(sm.confidenceScore) : null)}`}>
                          {sm.confidenceScore != null ? `${Number(sm.confidenceScore).toFixed(0)}%` : ""}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[#666666]">No suggestion</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#888888] bb-mono">
                    {fmtDate(sm.ingestionEvent?.receivedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {/* Confirm dialog */}
                      <Dialog
                        open={siteDialogOpen === sm.id}
                        onOpenChange={(open) => {
                          setSiteDialogOpen(open ? sm.id : null);
                          if (!open) setSelectedSiteId("");
                        }}
                      >
                        <DialogTrigger
                          render={
                            <Button
                              className="h-5 px-1.5 text-[9px] bg-[#00CC66] text-black hover:bg-[#00CC66]/80 uppercase tracking-wider font-bold"
                            >
                              <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                              Confirm
                            </Button>
                          }
                        />
                        <DialogContent className="bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0]">
                          <DialogHeader>
                            <DialogTitle className="text-[#FF6600] text-sm uppercase tracking-wider">
                              Confirm Site Match
                            </DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3 py-2">
                            <div className="text-[10px] text-[#888888]">
                              Raw text: <span className="text-[#E0E0E0] font-bold">{sm.rawSiteText}</span>
                            </div>
                            <div>
                              <Label className="text-[10px] text-[#888888] uppercase tracking-wider">
                                Select Site
                              </Label>
                              <Select value={selectedSiteId} onValueChange={(v) => setSelectedSiteId(v ?? "")}>
                                <SelectTrigger className="h-7 bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px] mt-1">
                                  <SelectValue placeholder="Choose a site..." />
                                </SelectTrigger>
                                <SelectContent className="bg-[#222222] border-[#333333]">
                                  {sites.map((s) => (
                                    <SelectItem key={s.id} value={s.id}>
                                      {s.siteName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <DialogFooter className="bg-[#151515] border-[#333333]">
                            <Button
                              className="h-6 px-3 text-[10px] bg-[#FF6600] text-black hover:bg-[#FF9900] uppercase tracking-wider font-bold"
                              onClick={() => resolveSite(sm.id, "confirm", { siteId: selectedSiteId })}
                              disabled={!selectedSiteId || actionLoading === sm.id}
                            >
                              {actionLoading === sm.id ? "Saving..." : "Confirm"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Create Site dialog */}
                      <Dialog
                        open={createSiteDialogOpen === sm.id}
                        onOpenChange={(open) => {
                          setCreateSiteDialogOpen(open ? sm.id : null);
                          if (!open) setNewSiteName("");
                        }}
                      >
                        <DialogTrigger
                          render={
                            <Button
                              variant="outline"
                              className="h-5 px-1.5 text-[9px] border-[#333333] text-[#3399FF] hover:bg-[#222222] uppercase tracking-wider font-bold"
                            >
                              <Plus className="h-2.5 w-2.5 mr-0.5" />
                              Create
                            </Button>
                          }
                        />
                        <DialogContent className="bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0]">
                          <DialogHeader>
                            <DialogTitle className="text-[#FF6600] text-sm uppercase tracking-wider">
                              Create New Site
                            </DialogTitle>
                          </DialogHeader>
                          <div className="space-y-3 py-2">
                            <div className="text-[10px] text-[#888888]">
                              Raw text: <span className="text-[#E0E0E0] font-bold">{sm.rawSiteText}</span>
                            </div>
                            <div>
                              <Label className="text-[10px] text-[#888888] uppercase tracking-wider">
                                Site Name
                              </Label>
                              <Input
                                value={newSiteName}
                                onChange={(e) => setNewSiteName(e.target.value)}
                                placeholder={sm.rawSiteText}
                                className="h-7 bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px] mt-1"
                              />
                            </div>
                          </div>
                          <DialogFooter className="bg-[#151515] border-[#333333]">
                            <Button
                              className="h-6 px-3 text-[10px] bg-[#FF6600] text-black hover:bg-[#FF9900] uppercase tracking-wider font-bold"
                              onClick={() => resolveSite(sm.id, "create_site", { siteData: { siteName: newSiteName || sm.rawSiteText } })}
                              disabled={actionLoading === sm.id}
                            >
                              {actionLoading === sm.id ? "Creating..." : "Create Site"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Not a Site */}
                      <Button
                        variant="outline"
                        className="h-5 px-1.5 text-[9px] border-[#333333] text-[#FF3333] hover:bg-[#222222] uppercase tracking-wider font-bold"
                        onClick={() => resolveSite(sm.id, "not_a_site")}
                        disabled={actionLoading === sm.id}
                      >
                        <Ban className="h-2.5 w-2.5 mr-0.5" />
                        Not Site
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* ── TAB 3: DRAFT INVOICE RECOVERY ────────────────────────── */}
      <TabsContent value="draft-recovery" className="space-y-3 mt-3">
        <div className="text-xs font-bold uppercase tracking-widest text-[#888888] mb-2">
          Draft Invoice Recovery Items
        </div>
        <div className="border border-[#333333]">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#333333] hover:bg-transparent">
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Zoho Invoice ID</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Customer</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Site</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Value</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Verification</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Issues</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {draftInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-[#666666] py-8 text-xs">
                    No draft invoice recovery items
                  </TableCell>
                </TableRow>
              )}
              {draftInvoices.map((di, idx) => (
                <TableRow
                  key={di.id}
                  className={`border-b border-[#333333] hover:bg-[#222222] ${idx % 2 === 1 ? "bg-[#151515]" : "bg-[#1A1A1A]"}`}
                >
                  <TableCell className="text-[10px] text-[#00CCCC] bb-mono font-bold">
                    {di.zohoInvoiceExternalId || "—"}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#E0E0E0]">
                    {di.customerId || "—"}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#E0E0E0]">
                    {di.siteId || "—"}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#E0E0E0] bb-mono font-bold">
                    {fmtMoney(di.totalValue)}
                  </TableCell>
                  <TableCell className="text-[10px]">
                    {statusBadge(di.status, DRAFT_STATUS_COLORS)}
                  </TableCell>
                  <TableCell className="text-[10px]">
                    {statusBadge(di.verificationStatus, DRAFT_STATUS_COLORS)}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#888888] max-w-[200px] truncate">
                    {di.issuesSummary || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        className="h-5 px-1.5 text-[9px] bg-[#00CC66] text-black hover:bg-[#00CC66]/80 uppercase tracking-wider font-bold"
                        onClick={() => updateDraftStatus(di.id, "VERIFIED_READY")}
                        disabled={actionLoading === di.id}
                      >
                        <CheckCircle className="h-2.5 w-2.5 mr-0.5" />
                        Verify
                      </Button>
                      <Button
                        className="h-5 px-1.5 text-[9px] bg-[#3399FF] text-black hover:bg-[#3399FF]/80 uppercase tracking-wider font-bold"
                        onClick={() => updateDraftStatus(di.id, "REBUILT")}
                        disabled={actionLoading === di.id}
                      >
                        <RefreshCw className="h-2.5 w-2.5 mr-0.5" />
                        Rebuild
                      </Button>
                      <Button
                        variant="outline"
                        className="h-5 px-1.5 text-[9px] border-[#333333] text-[#FF3333] hover:bg-[#222222] uppercase tracking-wider font-bold"
                        onClick={() => updateDraftStatus(di.id, "DISCARDED")}
                        disabled={actionLoading === di.id}
                      >
                        <Trash2 className="h-2.5 w-2.5 mr-0.5" />
                        Discard
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* ── TAB 4: RECONSTRUCTION ────────────────────────────────── */}
      <TabsContent value="reconstruction" className="space-y-3 mt-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-widest text-[#888888]">
            Reconstruction Batches
          </div>
          <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
            <DialogTrigger
              render={
                <Button className="h-6 px-3 text-[9px] bg-[#FF6600] text-black hover:bg-[#FF9900] uppercase tracking-wider font-bold">
                  <Plus className="h-3 w-3 mr-1" />
                  Create Batch
                </Button>
              }
            />
            <DialogContent className="bg-[#1A1A1A] border border-[#333333] text-[#E0E0E0]">
              <DialogHeader>
                <DialogTitle className="text-[#FF6600] text-sm uppercase tracking-wider">
                  Create Reconstruction Batch
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div>
                  <Label className="text-[10px] text-[#888888] uppercase tracking-wider">
                    Month (YYYY-MM)
                  </Label>
                  <Input
                    value={newBatchMonth}
                    onChange={(e) => setNewBatchMonth(e.target.value)}
                    placeholder="2024-01"
                    className="h-7 bg-[#222222] border-[#333333] text-[#E0E0E0] text-[10px] mt-1"
                  />
                </div>
              </div>
              <DialogFooter className="bg-[#151515] border-[#333333]">
                <Button
                  className="h-6 px-3 text-[10px] bg-[#FF6600] text-black hover:bg-[#FF9900] uppercase tracking-wider font-bold"
                  onClick={createBatch}
                  disabled={!newBatchMonth || actionLoading === "new-batch"}
                >
                  {actionLoading === "new-batch" ? "Creating..." : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="border border-[#333333]">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#333333] hover:bg-transparent">
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Month</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Bills Found</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Matched</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Unmatched</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reconstructionBatches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-[#666666] py-8 text-xs">
                    No reconstruction batches
                  </TableCell>
                </TableRow>
              )}
              {reconstructionBatches.map((batch, idx) => (
                <TableRow
                  key={batch.id}
                  className={`border-b border-[#333333] hover:bg-[#222222] ${idx % 2 === 1 ? "bg-[#151515]" : "bg-[#1A1A1A]"}`}
                >
                  <TableCell className="text-[10px] text-[#E0E0E0] bb-mono font-bold">
                    {batch.monthYear}
                  </TableCell>
                  <TableCell className="text-[10px]">
                    {statusBadge(batch.status, RECON_STATUS_COLORS)}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#E0E0E0] bb-mono">
                    {batch.billsFound}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#00CC66] bb-mono">
                    {batch.matched}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#FF3333] bb-mono">
                    {batch.unmatched}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#888888] max-w-[200px] truncate">
                    {batch.notes || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* ── TAB 5: SOURCES ───────────────────────────────────────── */}
      <TabsContent value="sources" className="space-y-3 mt-3">
        <div className="text-xs font-bold uppercase tracking-widest text-[#888888] mb-2">
          Ingestion Sources
        </div>
        <div className="border border-[#333333]">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#333333] hover:bg-transparent">
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Source Type</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Account Name</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Connector Status</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Last Sync</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Historical</TableHead>
                <TableHead className="text-[9px] text-[#888888] uppercase tracking-wider">Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-[#666666] py-8 text-xs">
                    No ingestion sources configured
                  </TableCell>
                </TableRow>
              )}
              {sources.map((src, idx) => (
                <TableRow
                  key={src.id}
                  className={`border-b border-[#333333] hover:bg-[#222222] ${idx % 2 === 1 ? "bg-[#151515]" : "bg-[#1A1A1A]"}`}
                >
                  <TableCell className="text-[10px]">
                    {sourceTypeBadge(src.sourceType)}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#E0E0E0]">
                    {src.accountName || "—"}
                  </TableCell>
                  <TableCell className="text-[10px]">
                    {src.connectorStatus ? (
                      <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 border ${
                        src.connectorStatus === "CONNECTED"
                          ? "bg-[#00CC66]/20 text-[#00CC66] border-[#00CC66]/30"
                          : src.connectorStatus === "ERROR"
                            ? "bg-[#FF3333]/20 text-[#FF3333] border-[#FF3333]/30"
                            : "bg-[#FF9900]/20 text-[#FF9900] border-[#FF9900]/30"
                      }`}>
                        {src.connectorStatus}
                      </span>
                    ) : (
                      <span className="text-[#666666] text-[10px]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-[#888888] bb-mono">
                    {fmtDate(src.lastSyncAt)}
                  </TableCell>
                  <TableCell className="text-center">
                    {src.isHistoricalCapable ? (
                      <Check className="h-3 w-3 text-[#00CC66] inline" />
                    ) : (
                      <X className="h-3 w-3 text-[#666666] inline" />
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {src.isActive ? (
                      <Check className="h-3 w-3 text-[#00CC66] inline" />
                    ) : (
                      <X className="h-3 w-3 text-[#FF3333] inline" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}

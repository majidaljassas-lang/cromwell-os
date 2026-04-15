"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Thread = {
  id: string;
  channel: "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER";
  subject: string | null;
  participants: string[];
  classification: string | null;
  latestAt: string;
  firstAt: string;
  messageCount: number;
  lastSnippet: string | null;
  status: "NEW" | "TRIAGED" | "LINKED" | "NOISE" | "ARCHIVED";
  linkConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  linkSource: "AUTO" | "MANUAL" | null;
  linkedTicket: {
    id: string;
    ticketNo: number;
    title: string;
    status?: string;
    customer: { id: string; name: string } | null;
    site: { id: string; siteName: string } | null;
  } | null;
};

// Primary action per thread classification for HIGH-confidence ticket-linked rows.
// The button navigates to the ticket page — the ticket view handles the actual work.
const CLASS_ACTION: Record<string, string> = {
  DELIVERY: "Confirm Delivery",
  ORDER: "Add to Ticket",
  BILL: "Match Bill",
  QUOTE_REQUEST: "Open Ticket",
};
function classActionLabel(cls: string | null): string {
  if (!cls) return "Open Ticket";
  return CLASS_ACTION[cls] ?? "Open Ticket";
}

type ThreadMessage = {
  id: string;
  occurredAt: string;
  sender: string | null;
  snippet: string | null;
  hasAttachments: boolean;
};

const STATUS_COLOR: Record<Thread["status"], string> = {
  NEW:      "#FF6600",
  TRIAGED:  "#FFCC00",
  LINKED:   "#00CC66",
  NOISE:    "#888888",
  ARCHIVED: "#444444",
};
const CLASS_COLOR: Record<string, string> = {
  BILL:          "#00CCFF",
  ORDER:         "#00CC66",
  QUOTE_REQUEST: "#FFCC00",
  DELIVERY:      "#00CC66",
  QUERY:         "#CCCCCC",
  REPLY:         "#888888",
  NOISE:         "#555555",
  UNKNOWN:       "#888888",
};
const CHANNEL_ICON: Record<Thread["channel"], string> = {
  EMAIL: "✉",
  WHATSAPP: "💬",
  WHATSAPP_GROUP: "👥",
  SMS: "📱",
  OTHER: "•",
};

export function InboxThreadsPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<"NEW" | "TRIAGED" | "LINKED" | "NOISE" | "ALL">("NEW");
  const [channelFilter, setChannelFilter] = useState<"ALL" | "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP">("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, limit: "200" });
      if (channelFilter !== "ALL") params.set("channel", channelFilter);
      if (q) params.set("q", q);
      const r = await fetch(`/api/inbox/threads?${params.toString()}`);
      const j = await r.json();
      setThreads(j.threads ?? []);
      setCounts(j.counts ?? {});
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, channelFilter]);

  // Defensive JSON parser — Next.js dev returns HTML when a route throws, so
  // a naive r.json() crashes the UI with "Unexpected end of JSON input".
  async function safeJson(r: Response): Promise<any> {
    const text = await r.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { return { error: text.slice(0, 200) }; }
  }

  async function openThread(t: Thread) {
    setSelectedThread(t);
    setDrawerLoading(true);
    try {
      const r = await fetch(`/api/inbox/threads/${t.id}`);
      const j = await safeJson(r);
      setThreadMessages((j.thread?.messages ?? []).map((m: ThreadMessage) => ({
        id: m.id, occurredAt: m.occurredAt, sender: m.sender, snippet: m.snippet, hasAttachments: m.hasAttachments,
      })));
    } finally { setDrawerLoading(false); }
  }

  async function action(id: string, act: "ACCEPT" | "NOISE" | "UNDO" | "LINK", opts?: { ticketId?: string; title?: string }) {
    setWorking(id);
    setToast(null);
    try {
      const r = await fetch(`/api/inbox/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: act, ...opts }),
      });
      const j = await safeJson(r);
      if (r.ok) {
        if (act === "ACCEPT" && j.ticket) setToast(`✓ Ticket #${j.ticket.ticketNo} created from thread`);
        else if (act === "LINK")  setToast("✓ Thread confirmed · linked to ticket");
        else if (act === "NOISE") setToast("✓ Marked as noise");
        else if (act === "UNDO")  setToast("✓ Restored to NEW");
        await refresh();
        if (selectedThread?.id === id) setSelectedThread(null);
      } else {
        setToast(`✗ ${j.error ?? `HTTP ${r.status}`}`);
      }
    } finally { setWorking(null); }
  }

  async function hardDelete(id: string) {
    if (!confirm("Permanently delete this thread + its ingestion events from Cromwell OS?\n\nThe original email stays in Outlook; only OS-side records are wiped. Accounting-protected events (supplier bills) are preserved.")) return;
    setWorking(id);
    setToast(null);
    try {
      const r = await fetch(`/api/inbox/threads/${id}`, { method: "DELETE" });
      const j = await safeJson(r);
      if (r.ok) {
        setToast(`✓ Deleted · ${j.eventsDeleted} event(s) wiped${j.eventsProtected ? ` · ${j.eventsProtected} preserved (tied to bills)` : ""}`);
        await refresh();
        if (selectedThread?.id === id) setSelectedThread(null);
      } else setToast(`✗ ${j.error ?? "delete failed"}`);
    } finally { setWorking(null); }
  }

  async function clearAllNoise() {
    const noiseCount = counts.NOISE ?? 0;
    if (noiseCount === 0) { setToast("No NOISE threads to clear."); return; }
    if (!confirm(`Permanently delete all ${noiseCount} NOISE thread${noiseCount === 1 ? "" : "s"} + their ingestion events?\n\nEmails stay in Outlook. Accounting-protected events (bills) are preserved.`)) return;
    setWorking("bulk");
    setToast(null);
    try {
      const r = await fetch("/api/inbox/clear-noise", { method: "POST" });
      const j = await r.json();
      if (r.ok) {
        setToast(`✓ Cleared ${j.deleted}/${j.scanned} NOISE threads${j.eventsProtected ? ` · ${j.eventsProtected} events preserved (tied to bills)` : ""}`);
        await refresh();
      } else setToast(`✗ ${j.error ?? "clear-noise failed"}`);
    } finally { setWorking(null); }
  }

  const STATUSES: Array<typeof statusFilter> = ["NEW", "TRIAGED", "LINKED", "NOISE", "ALL"];

  // Action queue buckets for the NEW tab.
  const ticketActions   = threads.filter((t) => t.status === "NEW" && t.linkConfidence === "HIGH"   && t.linkedTicket);
  const confirmMatches  = threads.filter((t) => t.status === "NEW" && t.linkConfidence === "MEDIUM" && t.linkedTicket);
  const noiseSuggested  = threads.filter((t) => t.status === "NEW" && t.classification === "NOISE" && !ticketActions.includes(t) && !confirmMatches.includes(t));
  const triagePool      = threads.filter((t) => t.status === "NEW" && !ticketActions.includes(t) && !confirmMatches.includes(t) && !noiseSuggested.includes(t));
  const triageByClass = new Map<string, Thread[]>();
  for (const t of triagePool) {
    const k = t.classification ?? "UNKNOWN";
    const arr = triageByClass.get(k) ?? [];
    arr.push(t);
    triageByClass.set(k, arr);
  }

  return (
    <div className="space-y-3">
      {/* Headline + filters */}
      <div className="border border-[#333333] bg-[#0F0F0F] p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Inbox threads</div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: "#FF6600" }}>
              {counts.NEW ?? 0} awaiting triage
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {Object.entries(counts).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ")}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
              placeholder="Search subject / snippet / participant"
              className="h-7 w-64 px-2 text-xs bg-[#0A0A0A] border border-[#333333]"
            />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value as typeof channelFilter)}
              className="h-7 text-xs bg-[#0A0A0A] border border-[#333333] px-2"
            >
              <option value="ALL">All channels</option>
              <option value="EMAIL">Email</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="WHATSAPP_GROUP">WhatsApp groups</option>
            </select>
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
              {loading ? "..." : "↻"}
            </Button>
          </div>
        </div>
        {/* Status tabs + bulk action for NOISE tab */}
        <div className="mt-3 flex gap-1 items-center flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`text-[10px] uppercase tracking-wider px-2 py-1 border ${
                statusFilter === s
                  ? "border-[#FF6600] text-[#FF6600] bg-[#1A1A1A]"
                  : "border-[#333333] text-muted-foreground hover:border-[#555]"
              }`}
            >
              {s.toLowerCase()} {s !== "ALL" ? `(${counts[s] ?? 0})` : ""}
            </button>
          ))}
          {statusFilter === "NOISE" && (counts.NOISE ?? 0) > 0 && (
            <Button
              size="sm" variant="outline"
              className="h-6 text-[10px] text-red-500 border-red-700/60 ml-2"
              onClick={clearAllNoise}
              disabled={working === "bulk"}
              title="Permanently delete every NOISE thread + its events from OS (emails stay in Outlook)"
            >
              {working === "bulk" ? "Clearing…" : `🗑 Clear all noise (${counts.NOISE ?? 0})`}
            </Button>
          )}
        </div>
        {toast && (
          <div className="mt-2 text-xs" style={{ color: toast.startsWith("✓") ? "#00CC66" : "#FF3333" }}>{toast}</div>
        )}
      </div>

      {/* NEW view: ticket-action queue, grouped by link confidence & class */}
      {statusFilter === "NEW" && (
        <div className="space-y-4">
          {/* 1) HIGH confidence + linked ticket → single class-specific action */}
          {ticketActions.length > 0 && (
            <section className="border border-[#00CC66]/40 bg-[#0F0F0F]">
              <div className="px-3 py-2 border-b border-[#222] flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "#00CC66" }}>Ticket actions · {ticketActions.length}</div>
                <div className="text-[10px] text-muted-foreground">high confidence · one-click</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6"></TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Site</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Subject / Snippet</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ticketActions.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-[#161616]" onClick={() => openThread(t)}>
                      <TableCell className="text-base">{CHANNEL_ICON[t.channel]}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        <a href={`/tickets/${t.linkedTicket!.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          #{t.linkedTicket!.ticketNo}
                        </a>
                      </TableCell>
                      <TableCell className="text-xs max-w-[18ch] truncate" title={t.linkedTicket?.customer?.name ?? ""}>
                        {t.linkedTicket?.customer?.name ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs max-w-[18ch] truncate" title={t.linkedTicket?.site?.siteName ?? ""}>
                        {t.linkedTicket?.site?.siteName ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {t.classification && (
                          <Badge variant="outline" className="text-[9px]" style={{ color: CLASS_COLOR[t.classification] ?? "#888" }}>
                            {t.classification.replace(/_/g, " ").toLowerCase()}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-xs truncate" title={t.subject ?? ""}>
                          {t.subject ?? <span className="text-muted-foreground italic">(no subject)</span>}
                        </div>
                        {t.lastSnippet && <div className="text-[10px] text-muted-foreground truncate">{t.lastSnippet}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          <a
                            href={`/tickets/${t.linkedTicket!.id}?intent=${encodeURIComponent((t.classification ?? "").toLowerCase())}`}
                            className="h-5 text-[10px] px-2 inline-flex items-center bg-primary text-primary-foreground hover:opacity-90"
                          >
                            {classActionLabel(t.classification)}
                          </a>
                          <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 text-red-400" onClick={() => action(t.id, "NOISE")} disabled={working === t.id}>
                            ✗
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          {/* 2) MEDIUM confidence + linked ticket → one-tap confirm */}
          {confirmMatches.length > 0 && (
            <section className="border border-[#FFCC00]/40 bg-[#0F0F0F]">
              <div className="px-3 py-2 border-b border-[#222] flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "#FFCC00" }}>Confirm suggested ticket · {confirmMatches.length}</div>
                <div className="text-[10px] text-muted-foreground">medium confidence · one-tap to link</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6"></TableHead>
                    <TableHead>Suggested Ticket</TableHead>
                    <TableHead>Customer / Site</TableHead>
                    <TableHead>Class</TableHead>
                    <TableHead>Subject / Snippet</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmMatches.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-[#161616]" onClick={() => openThread(t)}>
                      <TableCell className="text-base">{CHANNEL_ICON[t.channel]}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        <a href={`/tickets/${t.linkedTicket!.id}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          #{t.linkedTicket!.ticketNo}
                        </a>
                        <div className="text-[10px] text-muted-foreground truncate max-w-[20ch]" title={t.linkedTicket?.title ?? ""}>{t.linkedTicket?.title}</div>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">
                        <div className="truncate max-w-[20ch]">{t.linkedTicket?.customer?.name ?? "—"}</div>
                        <div className="truncate max-w-[20ch]">{t.linkedTicket?.site?.siteName ?? "—"}</div>
                      </TableCell>
                      <TableCell>
                        {t.classification && (
                          <Badge variant="outline" className="text-[9px]" style={{ color: CLASS_COLOR[t.classification] ?? "#888" }}>
                            {t.classification.replace(/_/g, " ").toLowerCase()}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-xs truncate" title={t.subject ?? ""}>
                          {t.subject ?? <span className="text-muted-foreground italic">(no subject)</span>}
                        </div>
                        {t.lastSnippet && <div className="text-[10px] text-muted-foreground truncate">{t.lastSnippet}</div>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="default" className="h-5 text-[10px] px-2" onClick={() => action(t.id, "LINK", { ticketId: t.linkedTicket!.id })} disabled={working === t.id}>
                            ✓ Confirm
                          </Button>
                          <Button size="sm" variant="outline" className="h-5 text-[10px] px-2" onClick={() => action(t.id, "ACCEPT")} disabled={working === t.id}>
                            New ticket
                          </Button>
                          <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 text-red-400" onClick={() => action(t.id, "NOISE")} disabled={working === t.id}>
                            ✗
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          {/* 3) LOW / null confidence → batch triage, grouped by class label */}
          {triageByClass.size > 0 && (
            <section className="border border-[#333333] bg-[#0F0F0F]">
              <div className="px-3 py-2 border-b border-[#222] flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Triage · {triagePool.length}</div>
                <div className="text-[10px] text-muted-foreground">low/no confidence · grouped by class</div>
              </div>
              {[...triageByClass.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([cls, group]) => (
                  <div key={cls} className="border-t border-[#222] first:border-t-0">
                    <div className="px-3 py-1.5 bg-[#0A0A0A] flex items-baseline gap-2">
                      <Badge variant="outline" className="text-[9px]" style={{ color: CLASS_COLOR[cls] ?? "#888" }}>
                        {cls.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">{group.length}</span>
                    </div>
                    <Table>
                      <TableBody>
                        {group.map((t) => (
                          <TableRow key={t.id} className="cursor-pointer hover:bg-[#161616]" onClick={() => openThread(t)}>
                            <TableCell className="text-base w-6">{CHANNEL_ICON[t.channel]}</TableCell>
                            <TableCell className="text-xs text-muted-foreground tabular-nums w-36">
                              {new Date(t.latestAt).toLocaleString("en-GB")}
                            </TableCell>
                            <TableCell className="max-w-md">
                              <div className="text-xs truncate" title={t.subject ?? ""}>
                                {t.subject ?? <span className="text-muted-foreground italic">(no subject)</span>}
                              </div>
                              {t.lastSnippet && <div className="text-[10px] text-muted-foreground truncate">{t.lastSnippet}</div>}
                            </TableCell>
                            <TableCell className="text-[10px] text-muted-foreground max-w-[20ch] truncate" title={t.participants.join(", ")}>
                              {t.participants[0] ?? "—"}{t.participants.length > 1 ? ` +${t.participants.length - 1}` : ""}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                <Button size="sm" variant="default" className="h-5 text-[10px] px-2" onClick={() => action(t.id, "ACCEPT")} disabled={working === t.id}>
                                  ✓ Accept
                                </Button>
                                <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 text-red-400" onClick={() => action(t.id, "NOISE")} disabled={working === t.id}>
                                  ✗ Noise
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
            </section>
          )}

          {/* 4) Pre-classified noise → one-tap dismiss */}
          {noiseSuggested.length > 0 && (
            <section className="border border-[#555]/60 bg-[#0A0A0A]">
              <div className="px-3 py-2 border-b border-[#222] flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Likely noise · {noiseSuggested.length}</div>
                <div className="text-[10px] text-muted-foreground">one-tap dismiss</div>
              </div>
              <Table>
                <TableBody>
                  {noiseSuggested.map((t) => (
                    <TableRow key={t.id} className="cursor-pointer hover:bg-[#161616]" onClick={() => openThread(t)}>
                      <TableCell className="text-base w-6">{CHANNEL_ICON[t.channel]}</TableCell>
                      <TableCell className="text-xs text-muted-foreground tabular-nums w-36">
                        {new Date(t.latestAt).toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell className="max-w-md">
                        <div className="text-xs truncate text-muted-foreground" title={t.subject ?? ""}>
                          {t.subject ?? <span className="italic">(no subject)</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground max-w-[20ch] truncate" title={t.participants.join(", ")}>
                        {t.participants[0] ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 text-red-400" onClick={() => action(t.id, "NOISE")} disabled={working === t.id}>
                            ✗ Dismiss
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}

          {threads.length === 0 && (
            <div className="border border-[#333333] bg-[#1A1A1A] p-6 text-sm text-muted-foreground">
              {loading ? "Loading…" : "Nothing to triage right now."}
            </div>
          )}
        </div>
      )}

      {/* Flat table (used for TRIAGED / LINKED / NOISE / ALL) */}
      {statusFilter !== "NEW" && (
      <div className="border border-[#333333] bg-[#1A1A1A]">
        {threads.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">
            {loading ? "Loading…" : "Nothing to triage right now."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6"></TableHead>
                <TableHead>When</TableHead>
                <TableHead>Subject / Snippet</TableHead>
                <TableHead>Participants</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Msgs</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {threads.map((t) => (
                <TableRow
                  key={t.id}
                  className={`cursor-pointer hover:bg-[#222] ${selectedThread?.id === t.id ? "bg-[#222]" : ""}`}
                  onClick={() => openThread(t)}
                >
                  <TableCell className="text-base">{CHANNEL_ICON[t.channel]}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {new Date(t.latestAt).toLocaleString("en-GB")}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <div className="text-xs truncate" title={t.subject ?? ""}>
                      {t.subject ?? <span className="text-muted-foreground italic">(no subject)</span>}
                    </div>
                    {t.lastSnippet && (
                      <div className="text-[10px] text-muted-foreground truncate">{t.lastSnippet}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground max-w-[20ch] truncate" title={t.participants.join(", ")}>
                    {t.participants[0] ?? "—"}{t.participants.length > 1 ? ` +${t.participants.length - 1}` : ""}
                  </TableCell>
                  <TableCell>
                    {t.classification && (
                      <Badge variant="outline" className="text-[9px]" style={{ color: CLASS_COLOR[t.classification] ?? "#888" }}>
                        {t.classification.replace(/_/g, " ").toLowerCase()}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">{t.messageCount}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[9px]" style={{ color: STATUS_COLOR[t.status] }}>
                      {t.status.toLowerCase()}
                    </Badge>
                    {t.linkedTicket && (
                      <a href={`/tickets/${t.linkedTicket.id}`} className="ml-1 text-[10px] text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        #{t.linkedTicket.ticketNo}
                      </a>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                      {t.status === "NEW" && (
                        <>
                          <Button
                            size="sm" variant="default"
                            className="h-5 text-[10px] px-2"
                            onClick={() => action(t.id, "ACCEPT")}
                            disabled={working === t.id}
                          >
                            ✓ Accept → Ticket
                          </Button>
                          <Button
                            size="sm" variant="outline"
                            className="h-5 text-[10px] px-2 text-red-400"
                            onClick={() => action(t.id, "NOISE")}
                            disabled={working === t.id}
                          >
                            ✗ Noise
                          </Button>
                        </>
                      )}
                      {(t.status === "NOISE" || t.status === "LINKED") && (
                        <Button
                          size="sm" variant="outline"
                          className="h-5 text-[10px] px-2"
                          onClick={() => action(t.id, "UNDO")}
                          disabled={working === t.id}
                        >
                          ↶ Undo
                        </Button>
                      )}
                      {t.status === "NOISE" && (
                        <Button
                          size="sm" variant="outline"
                          className="h-5 text-[10px] px-2 text-red-500 border-red-700/60"
                          onClick={() => hardDelete(t.id)}
                          disabled={working === t.id}
                          title="Permanently delete thread + its ingestion events from OS (email stays in Outlook)"
                        >
                          🗑 Delete forever
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      )}

      {/* Drawer — full thread message timeline */}
      {selectedThread && (
        <div className="border border-[#FF6600] bg-[#0F0F0F] p-3">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{selectedThread.channel.toLowerCase()} · {selectedThread.messageCount} messages</div>
              <div className="text-sm font-medium">{selectedThread.subject ?? "(no subject)"}</div>
              <div className="text-[10px] text-muted-foreground">{selectedThread.participants.join(", ")}</div>
            </div>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => setSelectedThread(null)}>close ✕</button>
          </div>
          {drawerLoading ? (
            <div className="text-xs text-muted-foreground">Loading messages…</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {threadMessages.map((m) => (
                <div key={m.id} className="border border-[#222] bg-[#0A0A0A] p-2">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>{m.sender ?? "(unknown)"}</span>
                    <span>{new Date(m.occurredAt).toLocaleString("en-GB")}</span>
                  </div>
                  {m.hasAttachments && <Badge variant="outline" className="text-[9px] mt-1">📎 attachment</Badge>}
                  {m.snippet && <div className="text-xs mt-1 whitespace-pre-wrap">{m.snippet}</div>}
                </div>
              ))}
            </div>
          )}
          {selectedThread.status === "NEW" && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="default" onClick={() => action(selectedThread.id, "ACCEPT")} disabled={working === selectedThread.id}>
                ✓ Accept → new Ticket
              </Button>
              <Button size="sm" variant="outline" className="text-red-400" onClick={() => action(selectedThread.id, "NOISE")} disabled={working === selectedThread.id}>
                ✗ Noise
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

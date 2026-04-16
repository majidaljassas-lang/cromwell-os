"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  status: "NEW" | "TRIAGED" | "LINKED" | "NOISE" | "ARCHIVED" | "AUTO_TICKETED";
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

type ThreadMessage = {
  id: string;
  occurredAt: string;
  sender: string | null;
  snippet: string | null;
  hasAttachments: boolean;
};

const CHANNEL_ICON: Record<string, string> = {
  EMAIL: "✉", WHATSAPP: "💬", WHATSAPP_GROUP: "👥", SMS: "📱", OTHER: "•",
};

export function InboxThreadsPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("NEW");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: statusFilter, limit: "500" });
      if (channelFilter !== "ALL") params.set("channel", channelFilter);
      if (q) params.set("q", q);
      const r = await fetch(`/api/inbox/threads?${params.toString()}`);
      const j = await r.json();
      setThreads(j.threads ?? []);
      setCounts(j.counts ?? {});
      setSelected(new Set());
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, [statusFilter, channelFilter]);

  async function safeJson(r: Response): Promise<any> {
    const text = await r.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text.slice(0, 200) }; }
  }

  async function openThread(t: Thread) {
    setSelectedThread(t);
    setDrawerLoading(true);
    try {
      const r = await fetch(`/api/inbox/threads/${t.id}`);
      const j = await safeJson(r);
      setThreadMessages((j.thread?.messages ?? []).map((m: any) => ({
        id: m.id, occurredAt: m.occurredAt, sender: m.sender, snippet: m.snippet, hasAttachments: m.hasAttachments,
      })));
    } finally { setDrawerLoading(false); }
  }

  // ── Single actions ──

  async function doAction(id: string, act: string, opts?: Record<string, unknown>) {
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
        if (act === "ACCEPT" && j.ticket) setToast(`✓ Ticket #${j.ticket.ticketNo} created`);
        else if (act === "LINK") setToast("✓ Linked to ticket");
        await refresh();
        if (selectedThread?.id === id) setSelectedThread(null);
      } else {
        setToast(`✗ ${j.error ?? `HTTP ${r.status}`}`);
      }
    } finally { setWorking(null); }
  }

  async function doDelete(id: string) {
    setWorking(id);
    setToast(null);
    try {
      const r = await fetch(`/api/inbox/threads/${id}?force=1`, { method: "DELETE" });
      const j = await safeJson(r);
      if (r.ok) {
        setToast("✓ Deleted");
        await refresh();
        if (selectedThread?.id === id) setSelectedThread(null);
      } else setToast(`✗ ${j.error ?? "delete failed"}`);
    } finally { setWorking(null); }
  }

  // ── Bulk actions ──

  async function bulkDelete() {
    if (selected.size === 0) return;
    setWorking("bulk");
    setToast(null);
    let deleted = 0;
    for (const id of selected) {
      try {
        const r = await fetch(`/api/inbox/threads/${id}?force=1`, { method: "DELETE" });
        if (r.ok) deleted++;
      } catch {}
    }
    setToast(`✓ Deleted ${deleted} thread${deleted !== 1 ? "s" : ""}`);
    setWorking(null);
    await refresh();
  }

  async function bulkLink(ticketId: string) {
    if (selected.size === 0) return;
    setWorking("bulk");
    setToast(null);
    let linked = 0;
    for (const id of selected) {
      try {
        const r = await fetch(`/api/inbox/threads/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "LINK", ticketId }),
        });
        if (r.ok) linked++;
      } catch {}
    }
    setToast(`✓ Linked ${linked} thread${linked !== 1 ? "s" : ""} to ticket`);
    setWorking(null);
    await refresh();
  }

  // ── Selection helpers ──

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === threads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(threads.map((t) => t.id)));
    }
  }

  const allSelected = threads.length > 0 && selected.size === threads.length;

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="border border-[#333] bg-[#0F0F0F] p-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-3xl font-bold tabular-nums" style={{ color: "#FF6600" }}>
              INBOX
            </div>
            <div className="text-xs text-[#888] mt-0.5">
              {counts.NEW ?? 0} new · {counts.LINKED ?? 0} linked · {counts.NOISE ?? 0} noise
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") refresh(); }}
              placeholder="Search..."
              className="h-7 w-56 px-2 text-xs bg-[#0A0A0A] border border-[#333]"
            />
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="h-7 text-xs bg-[#0A0A0A] border border-[#333] px-2"
            >
              <option value="ALL">All channels</option>
              <option value="EMAIL">Email</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-7 text-xs bg-[#0A0A0A] border border-[#333] px-2"
            >
              <option value="NEW">New ({counts.NEW ?? 0})</option>
              <option value="LINKED">Linked ({counts.LINKED ?? 0})</option>
              <option value="ALL">All</option>
            </select>
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading} className="h-7 text-xs">
              {loading ? "..." : "↻"}
            </Button>
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mt-2 flex items-center gap-2 bg-[#1A1A1A] border border-[#444] px-3 py-2">
            <span className="text-xs font-bold text-[#FF6600]">{selected.size} selected</span>
            <Button size="sm" className="h-6 text-[10px] bg-red-600 hover:bg-red-700 text-white px-3"
              onClick={bulkDelete} disabled={working === "bulk"}>
              {working === "bulk" ? "..." : "Delete selected"}
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-[10px] px-3"
              onClick={() => {
                const ticketId = prompt("Enter ticket ID to link to:");
                if (ticketId) bulkLink(ticketId.trim());
              }} disabled={working === "bulk"}>
              Link to ticket
            </Button>
            <button className="text-[10px] text-[#888] ml-2" onClick={() => setSelected(new Set())}>
              Clear selection
            </button>
          </div>
        )}

        {toast && (
          <div className="mt-2 text-xs" style={{ color: toast.startsWith("✓") ? "#00CC66" : "#FF3333" }}>{toast}</div>
        )}
      </div>

      {/* Thread list */}
      <div className="border border-[#333] bg-[#0A0A0A]">
        {threads.length === 0 ? (
          <div className="p-6 text-sm text-[#888]">
            {loading ? "Loading..." : "Nothing here."}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#333]">
                <th className="p-2 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-[#FF6600]" />
                </th>
                <th className="p-2 w-6"></th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Date</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">From</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Subject / Message</th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal w-8">#</th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t) => {
                const isSelected = selected.has(t.id);
                const date = new Date(t.latestAt);
                const dateStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                const sender = t.participants[0] ?? "—";
                const senderShort = sender.includes("@") ? sender.split("@")[0] : sender;

                return (
                  <tr key={t.id}
                    className={`border-b border-[#222] hover:bg-[#161616] cursor-pointer ${isSelected ? "bg-[#FF6600]/5" : ""} ${selectedThread?.id === t.id ? "bg-[#1A1A1A]" : ""}`}
                    onClick={() => openThread(t)}
                  >
                    <td className="p-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleOne(t.id)} className="accent-[#FF6600]" />
                    </td>
                    <td className="p-2 text-sm">{CHANNEL_ICON[t.channel] ?? "•"}</td>
                    <td className="p-2 text-[#888] tabular-nums whitespace-nowrap">
                      <div>{dateStr}</div>
                      <div className="text-[10px]">{timeStr}</div>
                    </td>
                    <td className="p-2 max-w-[150px] truncate" title={sender}>
                      {senderShort}
                    </td>
                    <td className="p-2 max-w-md">
                      <div className="truncate font-medium" title={t.subject ?? ""}>
                        {t.subject ?? <span className="text-[#666] italic">(no subject)</span>}
                      </div>
                      {t.lastSnippet && <div className="text-[10px] text-[#666] truncate mt-0.5">{t.lastSnippet}</div>}
                      {t.linkedTicket && (
                        <a href={`/tickets/${t.linkedTicket.id}`} className="text-[10px] text-[#FF6600] hover:underline" onClick={(e) => e.stopPropagation()}>
                          → T-{t.linkedTicket.ticketNo} {t.linkedTicket.title?.slice(0, 30)}
                        </a>
                      )}
                    </td>
                    <td className="p-2 text-right tabular-nums text-[#888]">{t.messageCount}</td>
                    <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {t.status === "NEW" && (
                          <>
                            <Button size="sm" variant="default" className="h-5 text-[10px] px-2"
                              onClick={() => doAction(t.id, "ACCEPT")} disabled={working === t.id}>
                              Accept
                            </Button>
                            <Button size="sm" className="h-5 text-[10px] px-2 bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => doDelete(t.id)} disabled={working === t.id}>
                              Delete
                            </Button>
                          </>
                        )}
                        {t.status === "LINKED" && (
                          <Button size="sm" variant="outline" className="h-5 text-[10px] px-2"
                            onClick={() => doAction(t.id, "UNDO")} disabled={working === t.id}>
                            Undo
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Thread detail drawer */}
      {selectedThread && (
        <div className="border border-[#FF6600] bg-[#0F0F0F] p-3">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#888]">
                {selectedThread.channel.toLowerCase()} · {selectedThread.messageCount} messages
              </div>
              <div className="text-sm font-medium">{selectedThread.subject ?? "(no subject)"}</div>
              <div className="text-[10px] text-[#888]">{selectedThread.participants.join(", ")}</div>
            </div>
            <button className="text-xs text-[#888]" onClick={() => setSelectedThread(null)}>close ✕</button>
          </div>
          {drawerLoading ? (
            <div className="text-xs text-[#888]">Loading...</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-auto">
              {threadMessages.map((m) => (
                <div key={m.id} className="border border-[#222] bg-[#0A0A0A] p-2">
                  <div className="flex items-center justify-between text-[10px] text-[#888]">
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
              <Button size="sm" variant="default" onClick={() => doAction(selectedThread.id, "ACCEPT")} disabled={working === selectedThread.id}>
                Accept → new Ticket
              </Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => doDelete(selectedThread.id)} disabled={working === selectedThread.id}>
                Delete
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

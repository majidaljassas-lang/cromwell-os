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

type Customer = { id: string; name: string };
type Site = { id: string; siteName: string };

export function InboxThreadsPanel({ initialStatus }: { initialStatus?: string } = {}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus ?? "NEW");
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Array<{ ticketId: string; ticketNo: number; title: string; customer: string; site: string; score: number; reasons: string[] }>>([]);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // New Ticket form state
  const [newTicketThread, setNewTicketThread] = useState<Thread | null>(null);
  const [ntTitle, setNtTitle] = useState("");
  const [ntCustomerId, setNtCustomerId] = useState("");
  const [ntSiteId, setNtSiteId] = useState("");
  const [ntMode, setNtMode] = useState("PRICING_FIRST");
  const [ntSource, setNtSource] = useState("");
  const [ntSaving, setNtSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [allSites, setAllSites] = useState<Site[]>([]);
  const [commercialLinks, setCommercialLinks] = useState<Array<{ customerId: string; siteId: string }>>([]);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newSiteName, setNewSiteName] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [creatingSite, setCreatingSite] = useState(false);
  const [triageThreadId, setTriageThreadId] = useState<string | null>(null);
  const [triageAction, setTriageAction] = useState("RESPOND");
  const [triageDueAt, setTriageDueAt] = useState("");
  const [triageNote, setTriageNote] = useState("");

  async function submitTriage() {
    if (!triageThreadId) return;
    setWorking(triageThreadId);
    try {
      const r = await fetch(`/api/inbox/threads/${triageThreadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "TRIAGE", triageAction, triageDueAt: triageDueAt || undefined, triageNote: triageNote || undefined }),
      });
      if (r.ok) {
        setToast(`✓ Triaged as ${triageAction}`);
        setTriageThreadId(null);
        await refresh();
      }
    } finally { setWorking(null); }
  }

  async function markDone(id: string) {
    setWorking(id);
    try {
      await fetch(`/api/inbox/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DONE" }),
      });
      setToast("✓ Done");
      await refresh();
    } finally { setWorking(null); }
  }
  const [tickets, setTickets] = useState<Array<{ id: string; ticketNo: number; title: string }>>([]);

  // Load customers + sites + commercial links once
  function loadLookups() {
    fetch("/api/customers").then(r => r.ok ? r.json() : []).then(d => setCustomers(Array.isArray(d) ? d : d.customers ?? [])).catch(() => {});
    fetch("/api/sites").then(r => r.ok ? r.json() : []).then(d => setAllSites(Array.isArray(d) ? d : d.sites ?? [])).catch(() => {});
    fetch("/api/commercial-links").then(r => r.ok ? r.json() : []).then(d => setCommercialLinks(Array.isArray(d) ? d : d.links ?? [])).catch(() => {});
    fetch("/api/tickets?active=1").then(r => r.ok ? r.json() : []).then(d => {
      const list = Array.isArray(d) ? d : d.tickets ?? [];
      setTickets(list.map((t: any) => ({ id: t.id, ticketNo: t.ticketNo, title: t.title })));
    }).catch(() => {});
  }
  useEffect(() => { loadLookups(); }, []);

  // Sites filtered by selected customer's commercial links
  const customerSites = ntCustomerId
    ? allSites.filter((s) => commercialLinks.some((l) => l.customerId === ntCustomerId && l.siteId === s.id))
    : [];

  async function createNewCustomer() {
    if (!newCustomerName.trim()) return;
    setCreatingCustomer(true);
    try {
      const r = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCustomerName.trim(), isBillingEntity: true }),
      });
      if (r.ok) {
        const c = await r.json();
        const id = c.id ?? c.customer?.id;
        const name = c.name ?? c.customer?.name ?? newCustomerName.trim();
        setCustomers((prev) => [...prev, { id, name }].sort((a, b) => a.name.localeCompare(b.name)));
        setNtCustomerId(id);
        setNewCustomerName("");
      }
    } finally { setCreatingCustomer(false); }
  }

  async function createNewSite() {
    if (!newSiteName.trim() || !ntCustomerId) return;
    setCreatingSite(true);
    try {
      // Create site
      const r = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteName: newSiteName.trim() }),
      });
      if (r.ok) {
        const s = await r.json();
        const siteId = s.id ?? s.site?.id;
        const siteName = s.siteName ?? s.site?.siteName ?? newSiteName.trim();

        // Create commercial link between customer and new site
        await fetch("/api/commercial-links", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: ntCustomerId, siteId }),
        });

        setAllSites((prev) => [...prev, { id: siteId, siteName }].sort((a, b) => a.siteName.localeCompare(b.siteName)));
        setCommercialLinks((prev) => [...prev, { customerId: ntCustomerId, siteId }]);
        setNtSiteId(siteId);
        setNewSiteName("");
      }
    } finally { setCreatingSite(false); }
  }

  function openNewTicketForm(t: Thread) {
    setNewTicketThread(t);
    setNtTitle(t.subject ?? "");
    setNtCustomerId("");
    setNtSiteId("");
    setNtMode("PRICING_FIRST");
    const srcMap: Record<string, string> = { EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", WHATSAPP_GROUP: "WHATSAPP", SMS: "SMS" };
    setNtSource(srcMap[t.channel] ?? "OTHER");
  }

  async function submitNewTicket() {
    if (!newTicketThread) return;
    setNtSaving(true);
    try {
      const r = await fetch(`/api/inbox/threads/${newTicketThread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ACCEPT",
          title: ntTitle || undefined,
          customerId: ntCustomerId || undefined,
          siteId: ntSiteId || undefined,
          ticketMode: ntMode,
          source: ntSource || undefined,
        }),
      });
      const j = await safeJson(r);
      if (r.ok && j.ticket) {
        setToast(`✓ Ticket T-${j.ticket.ticketNo} created`);
        setNewTicketThread(null);
        if (selectedThread?.id === newTicketThread.id) setSelectedThread(null);
        await refresh();
      } else {
        setToast(`✗ ${j.error ?? "Failed"}`);
      }
    } finally { setNtSaving(false); }
  }

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
    setSelectedMsgIds(new Set());
    setSuggestions([]);
    setDrawerLoading(true);
    try {
      const r = await fetch(`/api/inbox/threads/${t.id}`);
      const j = await safeJson(r);
      const msgs = (j.thread?.messages ?? []).map((m: any) => ({
        id: m.id, occurredAt: m.occurredAt, sender: m.sender, snippet: m.snippet, hasAttachments: m.hasAttachments,
      }));
      setThreadMessages(msgs);

      // Auto-suggest tickets based on thread content
      const fullText = [t.subject ?? "", ...msgs.map((m: any) => m.snippet ?? "")].join(" ");
      const sender = t.participants[0] ?? "";
      fetch("/api/inbox/suggest-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: fullText, sender }),
      }).then(r => r.ok ? r.json() : { suggestions: [] })
        .then(d => setSuggestions(d.suggestions ?? []))
        .catch(() => {});
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

  async function doDelete(id: string, block?: boolean) {
    setWorking(id);
    setToast(null);
    try {
      // If blocking, figure out what to block from the thread
      if (block) {
        const t = threads.find((t) => t.id === id);
        if (t) {
          const sender = t.participants[0] ?? "";
          if (t.channel === "EMAIL" && sender.includes("@")) {
            // Block by email address
            await fetch("/api/inbox/block", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ matchType: "EMAIL", value: sender, label: t.subject }),
            });
          } else if (t.channel === "WHATSAPP" || t.channel === "WHATSAPP_GROUP") {
            // Block by chat name or phone
            const chatName = t.subject || "";
            const chatId = sender;
            if (chatName) {
              await fetch("/api/inbox/block", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ matchType: "CHAT_NAME", value: chatName, label: chatName }),
              });
            } else if (chatId) {
              await fetch("/api/inbox/block", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ matchType: "PHONE", value: chatId, label: chatId }),
              });
            }
          }
        }
      }

      const r = await fetch(`/api/inbox/threads/${id}?force=1`, { method: "DELETE" });
      const j = await safeJson(r);
      if (r.ok) {
        setToast(block ? "✓ Deleted & blocked" : "✓ Deleted");
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

  async function bulkDeleteAndBlock() {
    if (selected.size === 0) return;
    setWorking("bulk");
    setToast(null);
    let deleted = 0;
    for (const id of selected) {
      try { await doDelete(id, true); deleted++; } catch {}
    }
    setToast(`✓ Deleted & blocked ${deleted} thread${deleted !== 1 ? "s" : ""}`);
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
    if (selected.size === sortedThreads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedThreads.map((t) => t.id)));
    }
  }

  const sortedThreads = [...threads].sort((a, b) => {
    const da = new Date(a.latestAt).getTime();
    const db = new Date(b.latestAt).getTime();
    return sortDir === "desc" ? db - da : da - db;
  });
  const allSelected = sortedThreads.length > 0 && selected.size === sortedThreads.length;

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
            <div className="flex gap-0.5">
              {[
                { key: "NEW", label: "New", color: "#FF6600" },
                { key: "TRIAGED", label: "To Do", color: "#FFCC00" },
                { key: "LINKED", label: "Linked", color: "#00CC66" },
                { key: "ALL", label: "All", color: "#888" },
              ].map((tab) => (
                <button key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`h-7 px-3 text-[10px] uppercase tracking-wider font-bold border transition-colors ${statusFilter === tab.key ? "text-black" : "text-[#888] border-[#333] hover:border-[#555]"}`}
                  style={statusFilter === tab.key ? { backgroundColor: tab.color, borderColor: tab.color } : {}}
                >
                  {tab.label} {tab.key !== "ALL" ? `(${counts[tab.key] ?? 0})` : ""}
                </button>
              ))}
            </div>
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
            <Button size="sm" className="h-6 text-[10px] bg-red-900 hover:bg-red-800 text-red-300 px-3"
              onClick={bulkDeleteAndBlock} disabled={working === "bulk"}>
              Delete & Block
            </Button>
            <select
              className="h-6 text-[10px] bg-[#0A0A0A] border border-[#444] px-2 rounded"
              defaultValue=""
              onChange={(e) => { if (e.target.value) bulkLink(e.target.value); e.target.value = ""; }}
              disabled={working === "bulk"}
            >
              <option value="">Link selected →</option>
              {tickets.map((tk) => (
                <option key={tk.id} value={tk.id}>T-{tk.ticketNo} {tk.title?.slice(0,30)}</option>
              ))}
            </select>
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
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal cursor-pointer hover:text-[#ccc] select-none"
                  onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}>
                  Date {sortDir === "desc" ? "↓" : "↑"}
                </th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">From</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Subject / Message</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Type</th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal w-8">#</th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedThreads.map((t) => {
                const isSelected = selected.has(t.id);
                const date = new Date(t.latestAt);
                const dateStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
                const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                const rawSender = (t as any).lastSender ?? t.participants[0] ?? "—";
                // Clean up: remove @c.us/@lid suffixes, show name not phone
                const senderShort = rawSender.includes("@c.us") ? rawSender.split("@")[0]
                  : rawSender.includes("@lid") ? rawSender.split("@")[0]
                  : rawSender.includes("@") ? rawSender.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
                  : rawSender;

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
                    <td className="p-2 max-w-[150px] truncate" title={rawSender}>
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
                    <td className="p-2">
                      {/* Triage action badge for TO DO items */}
                      {(t as any).triageAction && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded mr-1" style={{
                          color: ({ RESPOND: "#3399FF", PAY: "#FF3333", CHASE: "#FF9900", ADMIN: "#B366FF", REVIEW: "#888" } as Record<string, string>)[(t as any).triageAction] ?? "#888",
                          background: "rgba(255,255,255,0.05)",
                        }}>
                          {(t as any).triageAction}
                        </span>
                      )}
                      {t.classification && t.classification !== "UNKNOWN" && !(t as any).triageAction && (
                        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{
                          color: ({
                            BILL: "#00CCFF", BILL_DOCUMENT: "#00CCFF",
                            CUSTOMER_ORDER: "#00CC66", ORDER: "#00CC66",
                            SUPPLIER_ORDER_ACK: "#3399FF",
                            QUOTE_REQUEST: "#FFCC00", QUOTE: "#FFCC00",
                            DELIVERY: "#00CC66", DELIVERY_UPDATE: "#00CC66",
                            DISPUTE: "#FF3333",
                            APPROVAL: "#FF9900",
                            PO_DOCUMENT: "#3399FF",
                            NOISE: "#555",
                          } as Record<string, string>)[t.classification] ?? "#888",
                          background: "rgba(255,255,255,0.05)",
                        }}>
                          {(t.classification ?? "").replace(/_/g, " ").toLowerCase()}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right tabular-nums text-[#888]">{t.messageCount}</td>
                    <td className="p-2 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        {t.status === "NEW" && (
                          <>
                            <Button size="sm" variant="default" className="h-5 text-[10px] px-2"
                              onClick={() => openNewTicketForm(t)} disabled={working === t.id}>
                              New Ticket
                            </Button>
                            <select
                              className="h-5 text-[10px] bg-[#0A0A0A] border border-[#444] px-1 rounded"
                              defaultValue=""
                              onChange={(e) => { if (e.target.value) doAction(t.id, "LINK", { ticketId: e.target.value }); e.target.value = ""; }}
                              disabled={working === t.id}
                            >
                              <option value="">Link →</option>
                              {tickets.map((tk) => (
                                <option key={tk.id} value={tk.id}>T-{tk.ticketNo} {tk.title?.slice(0,30)}</option>
                              ))}
                            </select>
                            <Button size="sm" className="h-5 text-[10px] px-2 bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => doDelete(t.id)} disabled={working === t.id}>
                              Delete
                            </Button>
                            <select
                              className="h-5 text-[10px] bg-[#FFCC00]/10 border border-[#FFCC00]/30 text-[#FFCC00] px-1 rounded"
                              defaultValue=""
                              onChange={async (e) => {
                                if (!e.target.value) return;
                                setWorking(t.id);
                                try {
                                  const r = await fetch(`/api/inbox/threads/${t.id}`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ action: "TRIAGE", triageAction: e.target.value }),
                                  });
                                  if (r.ok) { setToast(`✓ → To Do (${e.target.value})`); await refresh(); }
                                } finally { setWorking(null); }
                                e.target.value = "";
                              }}
                              disabled={working === t.id}
                            >
                              <option value="">To Do →</option>
                              <option value="RESPOND">Respond</option>
                              <option value="PAY">Pay / Finance</option>
                              <option value="CHASE">Chase</option>
                              <option value="ADMIN">Admin</option>
                              <option value="REVIEW">Review</option>
                            </select>
                            <Button size="sm" className="h-5 text-[10px] px-2 bg-red-600 hover:bg-red-700 text-white"
                              onClick={() => doDelete(t.id)} disabled={working === t.id}>
                              Del
                            </Button>
                            <Button size="sm" className="h-5 text-[10px] px-1.5 bg-red-900 hover:bg-red-800 text-red-300"
                              onClick={() => doDelete(t.id, true)} disabled={working === t.id}
                              title="Delete and block future messages from this sender">
                              🚫
                            </Button>
                          </>
                        )}
                        {t.status === "TRIAGED" && (
                          <div className="flex gap-1">
                            <Button size="sm" className="h-5 text-[10px] px-2 bg-[#00CC66] hover:bg-[#00AA55] text-black"
                              onClick={() => markDone(t.id)} disabled={working === t.id}>
                              Done
                            </Button>
                            <Button size="sm" variant="default" className="h-5 text-[10px] px-2"
                              onClick={() => openNewTicketForm(t)} disabled={working === t.id}>
                              → Ticket
                            </Button>
                            <Button size="sm" variant="outline" className="h-5 text-[10px] px-2"
                              onClick={() => doAction(t.id, "UNDO")} disabled={working === t.id}>
                              Undo
                            </Button>
                          </div>
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

      {/* New Ticket form — fixed overlay */}
      {newTicketThread && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setNewTicketThread(null)}>
        <div className="border-2 border-[#FF6600] bg-[#0F0F0F] p-4 w-[600px] max-h-[80vh] overflow-auto rounded-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-[#FF6600]">New Ticket</div>
            <button className="text-xs text-[#888]" onClick={() => setNewTicketThread(null)}>cancel ✕</button>
          </div>
          <div className="text-[10px] text-[#888] mb-3">
            From: {newTicketThread.channel.toLowerCase()} · {newTicketThread.participants.join(", ")}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="col-span-2">
              <label className="text-[10px] uppercase tracking-wider text-[#888] block mb-1">Title</label>
              <input
                value={ntTitle} onChange={(e) => setNtTitle(e.target.value)}
                className="w-full h-8 px-2 text-xs bg-[#0A0A0A] border border-[#333]"
                placeholder="Job title"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#888] block mb-1">Source</label>
              <select
                value={ntSource} onChange={(e) => setNtSource(e.target.value)}
                className="w-full h-8 px-2 text-xs bg-[#0A0A0A] border border-[#333]"
              >
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="PHONE_CALL">Phone Call</option>
                <option value="WALK_IN">Walk-in</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#888] block mb-1">Mode</label>
              <select
                value={ntMode} onChange={(e) => setNtMode(e.target.value)}
                className="w-full h-8 px-2 text-xs bg-[#0A0A0A] border border-[#333]"
              >
                <option value="PRICING_FIRST">Pricing First</option>
                <option value="COMPETITIVE_BID">Competitive Bid</option>
                <option value="DIRECT_ORDER">Direct Order</option>
                <option value="SPEC_DRIVEN">Spec Driven</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#888] block mb-1">Customer *</label>
              <select
                value={ntCustomerId} onChange={(e) => { setNtCustomerId(e.target.value); setNtSiteId(""); }}
                className="w-full h-8 px-2 text-xs bg-[#0A0A0A] border border-[#333]"
              >
                <option value="">— select customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <div className="flex gap-1 mt-1">
                <input
                  value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createNewCustomer(); }}
                  className="flex-1 h-6 px-2 text-[10px] bg-[#0A0A0A] border border-[#444] placeholder-[#555]"
                  placeholder="+ New customer name"
                />
                {newCustomerName && (
                  <button onClick={createNewCustomer} disabled={creatingCustomer}
                    className="text-[10px] text-[#00CC66] hover:text-[#33FF99] px-2 font-bold">
                    {creatingCustomer ? "..." : "Add"}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[#888] block mb-1">Site <span className="text-[#555]">(optional)</span></label>
              <select
                value={ntSiteId} onChange={(e) => setNtSiteId(e.target.value)}
                className="w-full h-8 px-2 text-xs bg-[#0A0A0A] border border-[#333] disabled:opacity-40"
                disabled={!ntCustomerId}
              >
                <option value="">— {ntCustomerId ? (customerSites.length === 0 ? "no linked sites" : "select site") : "select customer first"} —</option>
                {customerSites.map((s) => (
                  <option key={s.id} value={s.id}>{s.siteName}</option>
                ))}
              </select>
              {ntCustomerId && (
                <div className="flex gap-1 mt-1">
                  <input
                    value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") createNewSite(); }}
                    className="flex-1 h-6 px-2 text-[10px] bg-[#0A0A0A] border border-[#444] placeholder-[#555]"
                    placeholder="+ New site (auto-links to customer)"
                  />
                  {newSiteName && (
                    <button onClick={createNewSite} disabled={creatingSite}
                      className="text-[10px] text-[#00CC66] hover:text-[#33FF99] px-2 font-bold">
                      {creatingSite ? "..." : "Add"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Preview of thread content */}
          <div className="bg-[#0A0A0A] border border-[#333] p-2 mb-3 max-h-48 overflow-auto">
            <div className="text-[10px] uppercase tracking-wider text-[#888] mb-1">Thread preview</div>
            <div className="text-xs whitespace-pre-wrap text-[#ccc]">
              {newTicketThread.lastSnippet || newTicketThread.subject || "(no content)"}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => setNewTicketThread(null)}>Cancel</Button>
            <Button size="sm" className="bg-[#FF6600] hover:bg-[#FF9900] text-black font-bold"
              onClick={submitNewTicket} disabled={ntSaving}>
              {ntSaving ? "Creating..." : "Create Ticket"}
            </Button>
          </div>
        </div>
        </div>
      )}

      {/* Thread detail drawer with message-level actions */}
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
            <button className="text-xs text-[#888]" onClick={() => { setSelectedThread(null); setSelectedMsgIds(new Set()); }}>close ✕</button>
          </div>

          {/* Ticket suggestions */}
          {suggestions.length > 0 && (
            <div className="bg-[#001A0A] border border-[#00CC66]/30 rounded p-2 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-[#00CC66] mb-1.5">Suggested tickets</div>
              <div className="space-y-1">
                {suggestions.map((s) => (
                  <div key={s.ticketId} className="flex items-center justify-between gap-2 py-1 border-b border-[#222] last:border-0">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-[#FF6600]">T-{s.ticketNo}</span>
                      <span className="text-xs text-[#ccc] ml-2">{s.title?.slice(0, 40)}</span>
                      {s.site && <span className="text-[10px] text-[#888] ml-2">{s.site}</span>}
                      <div className="text-[9px] text-[#666]">{s.reasons.join(" · ")}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[9px] tabular-nums text-[#00CC66]">{s.score}%</span>
                      <Button size="sm" className="h-5 text-[10px] px-2 bg-[#00CC66] hover:bg-[#00AA55] text-black"
                        onClick={() => doAction(selectedThread!.id, "LINK", { ticketId: s.ticketId })}
                        disabled={working === selectedThread?.id}>
                        Link
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Message-level action bar */}
          {selectedMsgIds.size > 0 && (
            <div className="flex items-center gap-2 bg-[#1A1A1A] border border-[#FF6600]/30 px-3 py-2 mb-2 rounded">
              <span className="text-[10px] font-bold text-[#FF6600]">{selectedMsgIds.size} message{selectedMsgIds.size !== 1 ? "s" : ""} selected</span>
              <Button size="sm" className="h-5 text-[10px] px-2" onClick={() => {
                // Build description from selected messages
                const selectedMsgs = threadMessages.filter(m => selectedMsgIds.has(m.id));
                const desc = selectedMsgs.map(m => `${m.sender ?? "?"} (${new Date(m.occurredAt).toLocaleString("en-GB")}):\n${m.snippet ?? ""}`).join("\n\n---\n\n");
                openNewTicketForm(selectedThread);
                // Override the title with a hint
                setTimeout(() => {
                  const titleEl = document.querySelector<HTMLInputElement>('input[placeholder="Job title"]');
                  if (titleEl && !titleEl.value) titleEl.focus();
                }, 100);
              }}>
                New Ticket from selected
              </Button>
              <select
                className="h-5 text-[10px] bg-[#0A0A0A] border border-[#444] px-1 rounded"
                defaultValue=""
                onChange={(e) => { if (e.target.value) doAction(selectedThread.id, "LINK", { ticketId: e.target.value }); e.target.value = ""; }}
              >
                <option value="">Link selected →</option>
                {tickets.map((tk) => (
                  <option key={tk.id} value={tk.id}>T-{tk.ticketNo} {tk.title?.slice(0,30)}</option>
                ))}
              </select>
              <Button size="sm" className="h-5 text-[10px] px-2 bg-red-600 hover:bg-red-700 text-white" onClick={async () => {
                // Delete selected messages from thread
                for (const msgId of selectedMsgIds) {
                  await fetch(`/api/inbox/messages/${msgId}`, { method: "DELETE" }).catch(() => {});
                }
                // Refresh thread
                setSelectedMsgIds(new Set());
                const r = await fetch(`/api/inbox/threads/${selectedThread.id}`);
                const j = await safeJson(r);
                setThreadMessages((j.thread?.messages ?? []).map((m: any) => ({
                  id: m.id, occurredAt: m.occurredAt, sender: m.sender, snippet: m.snippet, hasAttachments: m.hasAttachments,
                })));
                refresh();
              }}>
                Delete selected
              </Button>
              <button className="text-[10px] text-[#888] ml-2" onClick={() => setSelectedMsgIds(new Set())}>Clear</button>
            </div>
          )}

          {drawerLoading ? (
            <div className="text-xs text-[#888]">Loading...</div>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-auto">
              {/* Select all */}
              <div className="flex items-center gap-2 px-1 py-1 border-b border-[#333]">
                <input type="checkbox"
                  checked={threadMessages.length > 0 && selectedMsgIds.size === threadMessages.length}
                  onChange={() => {
                    if (selectedMsgIds.size === threadMessages.length) setSelectedMsgIds(new Set());
                    else setSelectedMsgIds(new Set(threadMessages.map(m => m.id)));
                  }}
                  className="accent-[#FF6600]" />
                <span className="text-[10px] text-[#888]">Select all</span>
              </div>
              {threadMessages.map((m) => {
                const isMsgSelected = selectedMsgIds.has(m.id);
                const isSent = (m.sender ?? "").toLowerCase().includes("majid") || (m.snippet ?? "").startsWith("[SENT]");
                return (
                  <div key={m.id}
                    className={`flex gap-2 border border-[#222] p-2 cursor-pointer hover:border-[#444] ${isMsgSelected ? "bg-[#FF6600]/10 border-[#FF6600]/30" : "bg-[#0A0A0A]"} ${isSent ? "ml-8" : "mr-8"}`}
                    onClick={() => {
                      setSelectedMsgIds(prev => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                        return next;
                      });
                    }}>
                    <input type="checkbox" checked={isMsgSelected} readOnly className="accent-[#FF6600] mt-1 shrink-0" onClick={e => e.stopPropagation()} onChange={() => {
                      setSelectedMsgIds(prev => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id); else next.add(m.id);
                        return next;
                      });
                    }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-[10px] text-[#888]">
                        <span className={isSent ? "text-[#FF9900]" : "text-[#3399FF]"}>{isSent ? "You" : (m.sender ?? "(unknown)")}</span>
                        <span>{new Date(m.occurredAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {m.hasAttachments && <Badge variant="outline" className="text-[9px] mt-0.5">📎</Badge>}
                      {m.snippet && <div className="text-xs mt-1 whitespace-pre-wrap">{m.snippet}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Thread-level actions */}
          {selectedThread.status === "NEW" && selectedMsgIds.size === 0 && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="default" onClick={() => openNewTicketForm(selectedThread)} disabled={working === selectedThread.id}>
                New Ticket (all)
              </Button>
              <select
                className="h-7 text-[10px] bg-[#0A0A0A] border border-[#444] px-1 rounded"
                defaultValue=""
                onChange={(e) => { if (e.target.value) doAction(selectedThread.id, "LINK", { ticketId: e.target.value }); e.target.value = ""; }}
                disabled={working === selectedThread.id}
              >
                <option value="">Link all →</option>
                {tickets.map((tk) => (
                  <option key={tk.id} value={tk.id}>T-{tk.ticketNo} {tk.title?.slice(0,30)}</option>
                ))}
              </select>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => doDelete(selectedThread.id)} disabled={working === selectedThread.id}>
                Delete
              </Button>
              <Button size="sm" className="bg-red-900 hover:bg-red-800 text-red-300" onClick={() => doDelete(selectedThread.id, true)} disabled={working === selectedThread.id}>
                Delete & Block
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

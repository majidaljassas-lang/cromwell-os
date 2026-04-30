"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Tag = {
  id: string;
  name: string;
  label: string;
  category: "FINANCIAL" | "OPERATIONAL" | "BOTH";
  routingHandler: string | null;
  description: string | null;
};

type Classification = {
  actionId: string;
  tagId: string;
  tagName: string;
  tagLabel: string;
  category: "FINANCIAL" | "OPERATIONAL" | "BOTH";
  ticketId: string | null;
  createdAt: string;
};

type Message = {
  id: string;
  ingestionEventId: string;
  threadId: string;
  channel: "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER";
  subject: string | null;
  conversationKey: string;
  sender: string | null;
  snippet: string | null;
  hasAttachments: boolean;
  occurredAt: string;
  classifications: Classification[];
  linkedTicket: {
    id: string;
    ticketNo: number;
    title: string;
    status?: string;
    customer: { id: string; name: string } | null;
    site: { id: string; siteName: string } | null;
  } | null;
};

type Ticket = { id: string; ticketNo: number; title: string };
type Customer = { id: string; name: string };
type Site = { id: string; siteName: string };
type CommercialLink = { customerId: string; siteId: string };

const CHANNEL_ICON: Record<string, string> = {
  EMAIL: "✉",
  WHATSAPP: "💬",
  WHATSAPP_GROUP: "👥",
  SMS: "📱",
  OTHER: "•",
};

const CATEGORY_COLOR: Record<string, string> = {
  FINANCIAL: "bg-emerald-900 text-emerald-200 border-emerald-700",
  OPERATIONAL: "bg-sky-900 text-sky-200 border-sky-700",
  BOTH: "bg-purple-900 text-purple-200 border-purple-700",
};

export function InboxMessagesPanel({ initialStatus }: { initialStatus?: string } = {}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>((initialStatus ?? "NEW").toUpperCase());
  const [channelFilter, setChannelFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [commercialLinks, setCommercialLinks] = useState<CommercialLink[]>([]);
  const [openClassifyFor, setOpenClassifyFor] = useState<Message | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("status", statusFilter);
    if (channelFilter !== "ALL") params.set("channel", channelFilter);
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", "300");
    fetch(`/api/inbox/messages?${params.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        setMessages(d.messages ?? []);
        setCounts(d.counts ?? {});
      })
      .catch(() => setToast("Failed to load inbox"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetch("/api/classification-tags")
      .then((r) => r.json())
      .then((d) => setTags(d.tags ?? []))
      .catch(() => {});
    fetch("/api/tickets?active=1")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const list = Array.isArray(d) ? d : d.tickets ?? [];
        setTickets(list.map((t: { id: string; ticketNo: number; title: string }) => ({ id: t.id, ticketNo: t.ticketNo, title: t.title })));
      })
      .catch(() => {});
    fetch("/api/customers")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCustomers(Array.isArray(d) ? d : d.customers ?? []))
      .catch(() => {});
    fetch("/api/sites")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setSites(Array.isArray(d) ? d : d.sites ?? []))
      .catch(() => {});
    fetch("/api/commercial-links")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setCommercialLinks(Array.isArray(d) ? d : d.links ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [statusFilter, channelFilter]);

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const tagsByCategory = useMemo(() => {
    const groups: Record<string, Tag[]> = { FINANCIAL: [], OPERATIONAL: [], BOTH: [] };
    for (const t of tags) groups[t.category].push(t);
    return groups;
  }, [tags]);

  async function deleteMessage(msgId: string) {
    if (!confirm("Delete this email permanently?")) return;
    setWorking(msgId);
    const res = await fetch(`/api/inbox/messages/${msgId}`, { method: "DELETE" });
    setWorking(null);
    if (!res.ok) {
      setToast("Delete failed");
      return;
    }
    setToast("Deleted");
    load();
  }

  async function applyClassification(
    messageId: string,
    tagIds: string[],
    ticketIds: string[],
    customerId: string | null,
    siteId: string | null,
  ) {
    if (tagIds.length === 0) {
      setToast("Pick at least one tag");
      return;
    }
    setWorking(messageId);
    const res = await fetch(`/api/inbox/messages/${messageId}/classify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tagIds, ticketIds, customerId, siteId }),
    });
    setWorking(null);
    if (!res.ok) {
      setToast("Classify failed");
      return;
    }
    const data = await res.json();
    const fired = (data.handlers ?? []).map((h: { tag: string; result: { ok: boolean; message: string } }) => `${h.tag}: ${h.result.message}`).join(" · ");
    setToast(fired || "Classified");
    setOpenClassifyFor(null);
    load();
  }

  return (
    <div className="font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-orange-400 uppercase tracking-wide">Inbox</h1>
          <div className="text-xs text-zinc-500">
            {counts.NEW ?? 0} new · {counts.CLASSIFIED ?? 0} classified · {counts.LINKED ?? 0} linked · manual mode
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
            placeholder="Search..."
            className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
          />
          <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs">
            <option value="ALL">All channels</option>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="WHATSAPP_GROUP">WA Group</option>
            <option value="SMS">SMS</option>
          </select>
          <TabBtn active={statusFilter === "NEW"} count={counts.NEW} onClick={() => setStatusFilter("NEW")}>NEW</TabBtn>
          <TabBtn active={statusFilter === "CLASSIFIED"} count={counts.CLASSIFIED} onClick={() => setStatusFilter("CLASSIFIED")}>CLASSIFIED</TabBtn>
          <TabBtn active={statusFilter === "LINKED"} count={counts.LINKED} onClick={() => setStatusFilter("LINKED")}>LINKED</TabBtn>
          <TabBtn active={statusFilter === "ALL"} count={counts.ALL} onClick={() => setStatusFilter("ALL")}>ALL</TabBtn>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>↻</Button>
        </div>
      </div>

      {toast && (
        <div className="mb-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200">{toast}</div>
      )}

      {/* Table */}
      <div className="border border-zinc-800 rounded overflow-hidden">
        <div className="grid grid-cols-[110px_1fr_2fr_1.5fr_300px] gap-2 px-3 py-2 bg-zinc-900 text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
          <div>Date</div>
          <div>From</div>
          <div>Subject / Message</div>
          <div>Tags / Ticket</div>
          <div className="text-right">Actions</div>
        </div>
        {loading && messages.length === 0 ? (
          <div className="p-6 text-center text-zinc-500">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="p-6 text-center text-zinc-500">No messages.</div>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              busy={working === m.id}
              onClassify={() => setOpenClassifyFor(m)}
              onDelete={() => deleteMessage(m.id)}
            />
          ))
        )}
      </div>

      {/* Classify modal */}
      {openClassifyFor && (
        <ClassifyModal
          message={openClassifyFor}
          tagsByCategory={tagsByCategory}
          tickets={tickets}
          customers={customers}
          sites={sites}
          commercialLinks={commercialLinks}
          busy={working === openClassifyFor.id}
          onCancel={() => setOpenClassifyFor(null)}
          onSubmit={(tagIds, ticketIds, customerId, siteId) =>
            applyClassification(openClassifyFor.id, tagIds, ticketIds, customerId, siteId)
          }
        />
      )}
    </div>
  );
}

function TabBtn({ active, count, onClick, children }: { active: boolean; count?: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-xs uppercase tracking-wide ${active ? "bg-orange-500 text-zinc-900 font-bold" : "bg-zinc-900 border border-zinc-700 text-zinc-300"}`}
    >
      {children} {typeof count === "number" ? `(${count})` : ""}
    </button>
  );
}

function MessageRow({ msg, busy, onClassify, onDelete }: { msg: Message; busy: boolean; onClassify: () => void; onDelete: () => void }) {
  const date = new Date(msg.occurredAt);
  const dd = date.toLocaleString("en-GB", { day: "2-digit", month: "short" });
  const tt = date.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="grid grid-cols-[110px_1fr_2fr_1.5fr_300px] gap-2 px-3 py-2 border-b border-zinc-800/60 hover:bg-zinc-900/50 items-start">
      <div className="text-xs text-zinc-400">
        <div>{dd}</div>
        <div className="text-zinc-600">{tt}</div>
      </div>
      <div className="text-xs">
        <div className="text-zinc-500">{CHANNEL_ICON[msg.channel] ?? "•"}</div>
        <div className="truncate text-zinc-200">{msg.sender ?? "(unknown)"}</div>
      </div>
      <div className="text-xs min-w-0">
        <div className="font-semibold text-zinc-100 truncate">{msg.subject ?? "(no subject)"}</div>
        <div className="text-zinc-500 line-clamp-2">{msg.snippet ?? ""}</div>
      </div>
      <div className="text-xs space-y-1">
        {msg.classifications.length === 0 ? (
          <span className="text-zinc-600 italic">unclassified</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {dedupTags(msg.classifications).map((c) => (
              <Badge key={c.tagId} variant="outline" className={`${CATEGORY_COLOR[c.category]} text-[10px]`}>{c.tagLabel}</Badge>
            ))}
          </div>
        )}
        {msg.linkedTicket && (
          <div className="text-zinc-400">
            <a href={`/tickets/${msg.linkedTicket.id}`} className="text-orange-400 hover:underline">#{msg.linkedTicket.ticketNo}</a> {msg.linkedTicket.title}
            {msg.linkedTicket.customer && <span className="text-zinc-500"> · {msg.linkedTicket.customer.name}</span>}
          </div>
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="outline" disabled={busy} onClick={onClassify}>Classify</Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>Del</Button>
      </div>
    </div>
  );
}

function dedupTags(actions: Classification[]) {
  const seen = new Set<string>();
  const out: Classification[] = [];
  for (const a of actions) {
    if (seen.has(a.tagId)) continue;
    seen.add(a.tagId);
    out.push(a);
  }
  return out;
}

function ClassifyModal({
  message,
  tagsByCategory,
  tickets,
  customers,
  sites,
  commercialLinks,
  busy,
  onCancel,
  onSubmit,
}: {
  message: Message;
  tagsByCategory: Record<string, Tag[]>;
  tickets: Ticket[];
  customers: Customer[];
  sites: Site[];
  commercialLinks: CommercialLink[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (tagIds: string[], ticketIds: string[], customerId: string | null, siteId: string | null) => void;
}) {
  const [tagIds, setTagIds] = useState<Set<string>>(new Set());
  const [ticketIds, setTicketIds] = useState<Set<string>>(message.linkedTicket ? new Set([message.linkedTicket.id]) : new Set());
  const [ticketSearch, setTicketSearch] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [siteId, setSiteId] = useState<string>("");

  function toggleTag(id: string) {
    setTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleTicket(id: string) {
    setTicketIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredTickets = tickets.filter((t) => {
    if (!ticketSearch.trim()) return true;
    const s = ticketSearch.toLowerCase();
    return String(t.ticketNo).includes(s) || t.title.toLowerCase().includes(s);
  });

  const customerSites = customerId
    ? sites.filter((s) => commercialLinks.some((l) => l.customerId === customerId && l.siteId === s.id))
    : sites;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-950 border border-zinc-700 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-xs text-zinc-500">From {message.sender ?? "(unknown)"} · {new Date(message.occurredAt).toLocaleString("en-GB")}</div>
            <div className="font-bold text-zinc-100">{message.subject ?? "(no subject)"}</div>
          </div>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-200 text-xl leading-none">×</button>
        </div>
        {message.snippet && (
          <div className="mb-4 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded p-2 max-h-32 overflow-y-auto">{message.snippet}</div>
        )}

        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Tags (pick one or more)</div>
          {(["FINANCIAL", "OPERATIONAL", "BOTH"] as const).map((cat) => (
            <div key={cat} className="mb-3">
              <div className="text-[10px] text-zinc-600 uppercase mb-1">{cat}</div>
              <div className="flex flex-wrap gap-1">
                {tagsByCategory[cat]?.map((t) => {
                  const active = tagIds.has(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTag(t.id)}
                      title={t.description ?? ""}
                      className={`text-[11px] px-2 py-1 rounded border ${
                        active ? `${CATEGORY_COLOR[cat]} font-bold` : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Customer / Site (use when no ticket fits — creates a fresh ticket)</div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setSiteId(""); }}
              className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs"
            >
              <option value="">— customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={!customerId}
              className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-xs disabled:opacity-50"
            >
              <option value="">— site (optional) —</option>
              {customerSites.map((s) => (
                <option key={s.id} value={s.id}>{s.siteName}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">Tickets (optional, can pick multiple)</div>
          <input
            placeholder="Search ticket # or title..."
            value={ticketSearch}
            onChange={(e) => setTicketSearch(e.target.value)}
            className="w-full px-2 py-1 mb-2 bg-zinc-900 border border-zinc-700 rounded text-xs"
          />
          <div className="max-h-48 overflow-y-auto border border-zinc-800 rounded">
            {filteredTickets.slice(0, 100).map((t) => {
              const active = ticketIds.has(t.id);
              return (
                <label key={t.id} className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer hover:bg-zinc-900 ${active ? "bg-zinc-800" : ""}`}>
                  <input type="checkbox" checked={active} onChange={() => toggleTicket(t.id)} />
                  <span className="text-orange-400">#{t.ticketNo}</span>
                  <span className="truncate text-zinc-300">{t.title}</span>
                </label>
              );
            })}
            {filteredTickets.length === 0 && <div className="px-2 py-2 text-zinc-500 text-xs">No tickets match.</div>}
          </div>
          {ticketIds.size > 0 && (
            <div className="text-[10px] text-zinc-400 mt-1">{ticketIds.size} ticket(s) selected</div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            onClick={() => onSubmit(Array.from(tagIds), Array.from(ticketIds), customerId || null, siteId || null)}
            disabled={busy || tagIds.size === 0}
          >
            {busy ? "Applying…" : `Apply ${tagIds.size} tag${tagIds.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Data {
  inbox: { newCount: number; emailCount: number; whatsappCount: number };
  tickets: {
    total: number;
    byStatus: Record<string, number>;
    byMode: Record<string, number>;
    recent: Array<{ id: string; ticketNo: number; title: string; status: string; mode: string; customer: string; site: string; lines: number; createdAt: string }>;
  };
  financial: {
    receivables: number; receivablesCount: number;
    payables: number; payablesCount: number;
    disputed: number; disputedCount: number;
  };
  tasks: { total: number; byType: Record<string, number> };
  stock: { itemCount: number; totalValue: number };
  system: { lastSync: string | null; eventsToday: number };
}

function fmt(n: number): string {
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

const STATUS_FLOW = [
  { key: "CAPTURED", label: "Captured", color: "#888", icon: "📥" },
  { key: "PRICING", label: "Pricing", color: "#FFCC00", icon: "💰" },
  { key: "QUOTED", label: "Quoted", color: "#3399FF", icon: "📋" },
  { key: "APPROVED", label: "Approved", color: "#00CC66", icon: "✅" },
  { key: "ORDERED", label: "Ordered", color: "#FF9900", icon: "📦" },
  { key: "DELIVERED", label: "Delivered", color: "#00CC66", icon: "🚚" },
  { key: "INVOICED", label: "Invoiced", color: "#33CC66", icon: "🧾" },
];

export function CommandCentreView() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/command-centre/v2", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);

  if (loading) return <div className="text-sm text-[#888] p-8">Loading command centre...</div>;
  if (!data) return <div className="text-sm text-[#FF3333] p-8">Failed to load</div>;

  const d = data;
  const pipelineTotal = STATUS_FLOW.reduce((s, st) => s + (d.tickets.byStatus[st.key] ?? 0), 0);

  return (
    <div className="space-y-5">

      {/* RED ALERTS — urgent actions */}
      {(d as any).urgentAlerts?.length > 0 && (
        <div className="rounded-lg border-2 border-[#FF3333] bg-[#1A0000] p-4 animate-pulse-slow">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🚨</span>
            <span className="text-[10px] uppercase tracking-widest font-black text-[#FF3333]">Action Required — {(d as any).urgentAlerts.length} urgent</span>
          </div>
          <div className="space-y-2">
            {(d as any).urgentAlerts.map((alert: any, i: number) => {
              const labels: Record<string, string> = {
                MATCH_BILL_TO_TICKET: "Match supplier bill",
                MARKUP_AND_INVOICE: "Invoice customer",
                CHASE_PAYMENT: "Chase payment",
                CONFIRM_DELIVERY_RECEIPT: "Confirm delivery",
                PLACE_ORDER_WITH_SUPPLIER: "Place order",
                PRICE_ITEMS: "Price items",
                CHASE_FOLLOW_UP: "Follow up",
              };
              return (
                <Link key={i} href={`/tickets/${alert.ticketId}`} className="flex items-center justify-between py-1.5 border-b border-[#FF3333]/20 last:border-0 hover:bg-[#FF3333]/5 px-2 rounded">
                  <div>
                    <span className="text-xs font-bold text-[#FF3333]">{labels[alert.taskType] ?? alert.taskType.replace(/_/g, " ")}</span>
                    <span className="text-xs text-[#888] ml-2">CP-{String(alert.ticketNo).padStart(4, "0")} {alert.ticketTitle}</span>
                  </div>
                  <span className="text-[10px] text-[#FF3333]">→</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Hero cards row */}
      <div className="grid grid-cols-5 gap-3">
        {/* Inbox */}
        <Link href="/inbox" className="group relative overflow-hidden rounded-lg border border-[#FF6600]/30 bg-gradient-to-br from-[#1A0A00] to-[#0D0D0D] p-4 hover:border-[#FF6600] transition-all">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#FF6600]/70">Inbox</div>
              <div className="text-4xl font-black text-[#FF6600] mt-1">{d.inbox.newCount}</div>
              <div className="text-[11px] text-[#888] mt-1">{d.inbox.emailCount} email · {d.inbox.whatsappCount} whatsapp</div>
            </div>
            <div className="text-5xl opacity-20 group-hover:opacity-40 transition-opacity">📨</div>
          </div>
          {d.inbox.newCount > 0 && (
            <div className="mt-3 text-[10px] font-bold text-[#FF6600] uppercase tracking-wider group-hover:underline">
              Triage now →
            </div>
          )}
        </Link>

        {/* To Do */}
        <Link href="/inbox?status=TRIAGED" className="group relative overflow-hidden rounded-lg border border-[#FFCC00]/30 bg-gradient-to-br from-[#1A1500] to-[#0D0D0D] p-4 hover:border-[#FFCC00] transition-all">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#FFCC00]/70">To Do</div>
              <div className="text-4xl font-black text-[#FFCC00] mt-1">{d.inbox.triagedCount ?? 0}</div>
              <div className="text-[11px] text-[#888] mt-1">{d.inbox.overdueCount ?? 0} overdue</div>
            </div>
            <div className="text-5xl opacity-20 group-hover:opacity-40 transition-opacity">📋</div>
          </div>
          {(d.inbox.overdueCount ?? 0) > 0 && (
            <div className="mt-2 text-[10px] text-[#FF3333] font-bold">⚠ {d.inbox.overdueCount} overdue</div>
          )}
        </Link>

        {/* Active jobs */}
        <Link href="/tickets" className="group relative overflow-hidden rounded-lg border border-[#3399FF]/30 bg-gradient-to-br from-[#000A1A] to-[#0D0D0D] p-4 hover:border-[#3399FF] transition-all">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#3399FF]/70">Active Jobs</div>
              <div className="text-4xl font-black text-[#3399FF] mt-1">{d.tickets.total}</div>
              <div className="text-[11px] text-[#888] mt-1">
                {d.tickets.byStatus.PRICING ?? 0} pricing · {d.tickets.byStatus.ORDERED ?? 0} ordered
              </div>
            </div>
            <div className="text-5xl opacity-20 group-hover:opacity-40 transition-opacity">🎯</div>
          </div>
          <div className="mt-3 text-[10px] font-bold text-[#3399FF] uppercase tracking-wider group-hover:underline">
            View tickets →
          </div>
        </Link>

        {/* Receivables */}
        <div className="relative overflow-hidden rounded-lg border border-[#00CC66]/30 bg-gradient-to-br from-[#001A0A] to-[#0D0D0D] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#00CC66]/70">Owed to you</div>
              <div className="text-4xl font-black text-[#00CC66] mt-1">{fmt(d.financial.receivables)}</div>
              <div className="text-[11px] text-[#888] mt-1">{d.financial.receivablesCount} invoice(s) outstanding</div>
            </div>
            <div className="text-5xl opacity-20">💷</div>
          </div>
        </div>

        {/* Payables */}
        <div className="relative overflow-hidden rounded-lg border border-[#FFCC00]/30 bg-gradient-to-br from-[#1A1500] to-[#0D0D0D] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#FFCC00]/70">You owe</div>
              <div className="text-4xl font-black text-[#FFCC00] mt-1">{fmt(d.financial.payables)}</div>
              <div className="text-[11px] text-[#888] mt-1">{d.financial.payablesCount} bill(s) unpaid</div>
            </div>
            <div className="text-5xl opacity-20">📄</div>
          </div>
          {d.financial.disputedCount > 0 && (
            <div className="mt-2 text-[10px] text-[#FF3333]">
              ⚠ {d.financial.disputedCount} disputed ({fmt(d.financial.disputed)})
            </div>
          )}
        </div>
      </div>

      {/* Pipeline */}
      <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-4">
        <div className="text-[10px] uppercase tracking-widest text-[#888] mb-4">Job Pipeline</div>
        <div className="flex gap-1 items-end">
          {STATUS_FLOW.map((st, i) => {
            const count = d.tickets.byStatus[st.key] ?? 0;
            const pct = pipelineTotal > 0 ? (count / pipelineTotal) * 100 : 0;
            const barHeight = count > 0 ? Math.max(24, Math.min(80, pct * 1.5)) : 8;
            return (
              <Link key={st.key} href={`/tickets?status=${st.key}`} className="flex-1 flex flex-col items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer">
                {/* Bar */}
                <div className="w-full rounded-t relative" style={{
                  height: barHeight,
                  backgroundColor: count > 0 ? st.color + "20" : "#1A1A1A",
                  borderBottom: `3px solid ${count > 0 ? st.color : "#333"}`,
                }}>
                  {count > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-black" style={{ color: st.color }}>{count}</span>
                    </div>
                  )}
                </div>
                {/* Label */}
                <div className="text-center">
                  <div className="text-sm">{st.icon}</div>
                  <div className="text-[9px] uppercase tracking-wider text-[#888]">{st.label}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Two column: Tasks + Recent tickets */}
      <div className="grid grid-cols-2 gap-3">

        {/* Tasks / Actions needed */}
        <div className="rounded-lg border border-[#FF9900]/30 bg-[#0B0B0B] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest text-[#FF9900]">Actions needed</div>
            <span className="text-xs font-bold text-[#FF9900] bg-[#FF9900]/10 px-2 py-0.5 rounded">{d.tasks.total}</span>
          </div>
          {d.tasks.total === 0 ? (
            <div className="text-xs text-[#666] py-4 text-center">All clear — no actions pending</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(d.tasks.byType).sort(([,a],[,b]) => b - a).map(([type, count]) => {
                const colors: Record<string, string> = {
                  BILL_NEEDS_REVIEW: "#00CCFF",
                  SUPPLIER_DISPUTE: "#FF3333",
                  LINK_PO: "#3399FF",
                  REVIEW_AUTO_TICKET: "#FF9900",
                  INVOICE_REQUIRED: "#00CC66",
                  CHASE_PAYMENT: "#FFCC00",
                  REVIEW_DISPUTE: "#FF3333",
                };
                const c = colors[type] ?? "#888";
                return (
                  <div key={type} className="flex items-center justify-between py-1.5 border-b border-[#222] last:border-0">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                      <span className="text-xs text-[#ccc]">{type.replace(/_/g, " ").toLowerCase()}</span>
                    </div>
                    <span className="text-sm font-bold tabular-nums" style={{ color: c }}>{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stock / Quick stats */}
        <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-4">
          <div className="text-[10px] uppercase tracking-widest text-[#888] mb-3">Quick Stats</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-[#222] rounded p-3 text-center">
              <div className="text-2xl font-black text-[#ccc]">{d.stock.itemCount}</div>
              <div className="text-[10px] text-[#888] mt-1">Stock items</div>
            </div>
            <div className="border border-[#222] rounded p-3 text-center">
              <div className="text-2xl font-black text-[#ccc]">{d.system.eventsToday}</div>
              <div className="text-[10px] text-[#888] mt-1">Events today</div>
            </div>
            <div className="border border-[#222] rounded p-3 text-center">
              <div className="text-2xl font-black text-[#ccc]">{d.tickets.byMode.COMPETITIVE_BID ?? 0}</div>
              <div className="text-[10px] text-[#888] mt-1">Competitive bids</div>
            </div>
            <div className="border border-[#222] rounded p-3 text-center">
              <div className="text-2xl font-black text-[#ccc]">{d.tickets.byMode.PRICING_FIRST ?? 0}</div>
              <div className="text-[10px] text-[#888] mt-1">Quotes pending</div>
            </div>
          </div>
        </div>
      </div>

      {/* Active tickets table */}
      <div className="rounded-lg border border-[#333] bg-[#0B0B0B] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#222] flex justify-between items-center">
          <div className="text-[10px] uppercase tracking-widest text-[#888]">Active Tickets</div>
          <Link href="/tickets" className="text-[10px] text-[#FF6600] hover:underline font-bold uppercase tracking-wider">
            View all →
          </Link>
        </div>
        {d.tickets.recent.length === 0 ? (
          <div className="p-6 text-sm text-[#666] text-center">No active tickets — triage your inbox to create jobs</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#333] bg-[#0A0A0A]">
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">#</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Job</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Customer</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Site</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Status</th>
                <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Mode</th>
                <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal">Lines</th>
              </tr>
            </thead>
            <tbody>
              {d.tickets.recent.map((t) => {
                const statusColors: Record<string, string> = {
                  CAPTURED: "#888", PRICING: "#FFCC00", QUOTED: "#3399FF", APPROVED: "#00CC66",
                  ORDERED: "#FF9900", DELIVERED: "#00CC66", INVOICED: "#33CC66",
                };
                return (
                  <tr key={t.id} className="border-b border-[#222] hover:bg-[#161616] cursor-pointer"
                    onClick={() => window.location.href = `/tickets/${t.id}`}>
                    <td className="px-4 py-2.5">
                      <span className="text-[#FF6600] font-bold">T-{t.ticketNo}</span>
                    </td>
                    <td className="px-4 py-2.5 max-w-[250px] truncate font-medium">{t.title}</td>
                    <td className="px-4 py-2.5 text-[#888] max-w-[150px] truncate">{t.customer || "—"}</td>
                    <td className="px-4 py-2.5 text-[#888] max-w-[150px] truncate">{t.site || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-bold"
                        style={{ color: statusColors[t.status] ?? "#888", background: (statusColors[t.status] ?? "#888") + "15" }}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[10px] text-[#888]">{(t.mode ?? "").replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#888]">{t.lines}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="text-[10px] text-[#444] flex justify-between px-1">
        <span>Last sync: {d.system.lastSync ? new Date(d.system.lastSync).toLocaleString("en-GB") : "never"}</span>
        <span>Auto-refreshes every 30s</span>
      </div>
    </div>
  );
}

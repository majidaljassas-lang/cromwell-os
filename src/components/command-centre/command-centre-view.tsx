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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    CAPTURED: "#888", PRICING: "#FFCC00", QUOTED: "#3399FF", APPROVED: "#00CC66",
    ORDERED: "#FF9900", DELIVERED: "#00CC66", INVOICED: "#33CC66", CLOSED: "#555",
  };
  return (
    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ color: colors[status] ?? "#888", background: "rgba(255,255,255,0.05)" }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

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

  if (loading) return <div className="text-sm text-[#888]">Loading...</div>;
  if (!data) return <div className="text-sm text-[#FF3333]">Failed to load</div>;

  const d = data;
  const statuses = ["CAPTURED", "PRICING", "QUOTED", "APPROVED", "ORDERED", "DELIVERED", "INVOICED"];

  return (
    <div className="space-y-4">
      {/* Top cards */}
      <div className="grid grid-cols-5 gap-2">
        <Link href="/inbox" className="border border-[#333] bg-[#0B0B0B] p-3 hover:border-[#FF6600] transition-colors">
          <div className="text-[10px] uppercase tracking-wider text-[#888]">Inbox</div>
          <div className="text-2xl font-bold text-[#FF6600]">{d.inbox.newCount}</div>
          <div className="text-[10px] text-[#666]">{d.inbox.emailCount} email · {d.inbox.whatsappCount} whatsapp</div>
        </Link>
        <div className="border border-[#333] bg-[#0B0B0B] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#888]">Active Tickets</div>
          <div className="text-2xl font-bold text-[#ccc]">{d.tickets.total}</div>
          <div className="text-[10px] text-[#666]">
            {d.tickets.byStatus.PRICING ?? 0} pricing · {d.tickets.byStatus.ORDERED ?? 0} ordered
          </div>
        </div>
        <div className="border border-[#333] bg-[#0B0B0B] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#888]">Open Tasks</div>
          <div className="text-2xl font-bold text-[#FF9900]">{d.tasks.total}</div>
          <div className="text-[10px] text-[#666]">
            {Object.entries(d.tasks.byType).slice(0, 2).map(([t, n]) => `${n} ${t.replace(/_/g, " ").toLowerCase()}`).join(" · ")}
          </div>
        </div>
        <div className="border border-[#333] bg-[#0B0B0B] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#888]">Receivables</div>
          <div className="text-2xl font-bold text-[#00CC66]">{fmt(d.financial.receivables)}</div>
          <div className="text-[10px] text-[#666]">{d.financial.receivablesCount} invoice(s)</div>
        </div>
        <div className="border border-[#333] bg-[#0B0B0B] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#888]">Payables</div>
          <div className="text-2xl font-bold text-[#FFCC00]">{fmt(d.financial.payables)}</div>
          <div className="text-[10px] text-[#666]">{d.financial.payablesCount} bill(s)</div>
        </div>
      </div>

      {/* Ticket pipeline */}
      <div className="border border-[#333] bg-[#0B0B0B] p-3">
        <div className="text-[10px] uppercase tracking-wider text-[#888] mb-3">Pipeline</div>
        <div className="flex gap-1">
          {statuses.map((s) => {
            const count = d.tickets.byStatus[s] ?? 0;
            const colors: Record<string, string> = {
              CAPTURED: "#555", PRICING: "#FFCC00", QUOTED: "#3399FF", APPROVED: "#00CC66",
              ORDERED: "#FF9900", DELIVERED: "#00CC66", INVOICED: "#33CC66",
            };
            return (
              <div key={s} className="flex-1 text-center border border-[#222] py-2 rounded"
                style={{ borderColor: count > 0 ? colors[s] : "#222" }}>
                <div className="text-lg font-bold tabular-nums" style={{ color: count > 0 ? colors[s] : "#444" }}>{count}</div>
                <div className="text-[9px] uppercase tracking-wider text-[#888]">{s}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active tickets list */}
      <div className="border border-[#333] bg-[#0B0B0B]">
        <div className="px-3 py-2 border-b border-[#222] flex justify-between items-center">
          <div className="text-[10px] uppercase tracking-wider text-[#888]">Active Tickets</div>
          <Link href="/tickets" className="text-[10px] text-[#FF6600] hover:underline">View all →</Link>
        </div>
        {d.tickets.recent.length === 0 ? (
          <div className="p-4 text-xs text-[#666]">No active tickets</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#222]">
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">No</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Title</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Customer</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Site</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Status</th>
                <th className="p-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Mode</th>
                <th className="p-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal">Lines</th>
              </tr>
            </thead>
            <tbody>
              {d.tickets.recent.map((t) => (
                <tr key={t.id} className="border-b border-[#222] hover:bg-[#161616]">
                  <td className="p-2">
                    <Link href={`/tickets/${t.id}`} className="text-[#FF6600] hover:underline">T-{t.ticketNo}</Link>
                  </td>
                  <td className="p-2 max-w-[250px] truncate">{t.title}</td>
                  <td className="p-2 text-[#888] max-w-[150px] truncate">{t.customer || "—"}</td>
                  <td className="p-2 text-[#888] max-w-[150px] truncate">{t.site || "—"}</td>
                  <td className="p-2"><StatusBadge status={t.status} /></td>
                  <td className="p-2 text-[10px] text-[#888]">{(t.mode ?? "").replace(/_/g, " ")}</td>
                  <td className="p-2 text-right tabular-nums text-[#888]">{t.lines}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tasks */}
      {d.tasks.total > 0 && (
        <div className="border border-[#333] bg-[#0B0B0B] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#888] mb-2">Open Tasks</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(d.tasks.byType).map(([type, count]) => (
              <div key={type} className="border border-[#333] px-3 py-1.5 rounded">
                <span className="text-xs font-medium text-[#ccc]">{count}</span>
                <span className="text-[10px] text-[#888] ml-1.5">{type.replace(/_/g, " ").toLowerCase()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-[10px] text-[#555] flex justify-between">
        <span>Last sync: {d.system.lastSync ? new Date(d.system.lastSync).toLocaleString("en-GB") : "never"}</span>
        <span>{d.system.eventsToday} events today</span>
      </div>
    </div>
  );
}

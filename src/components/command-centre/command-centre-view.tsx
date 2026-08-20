"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface AgingBuckets { current: number; d1_30: number; d31_60: number; d61_plus: number }
type Period = "Y" | "M" | "W" | "D";
interface Contributor { id: string; name: string; amount: number }
interface BucketPoint {
  key: string;
  label: string;
  isPast: boolean;
  cashIn: number;
  cashOut: number;
  pnlIncome: number;
  pnlCogs: number;
  pnlExpenses: number;
  insights: { topIncome: Contributor[]; topCogs: Contributor[]; topExpenses: Contributor[] };
}
interface CashFlow { period: Period; todayKey: string; buckets: BucketPoint[] }
interface PartyRow { id: string; name: string; amount: number; count: number }
interface BSLine { code: string; name: string; amount: number }
interface BalanceSheet {
  cash: { lines: BSLine[]; total: number };
  ar: { gross: number; net: number };
  otherDebtors: { lines: BSLine[]; total: number };
  otherCurrentAssets: { lines: BSLine[]; total: number };
  totalCurrentAssets: number;
  ap: { gross: number; net: number };
  otherCurrentLiabilities: { lines: BSLine[]; total: number };
  totalCurrentLiabilities: number;
  netCurrentAssets: number;
  draftInvoices: { gross: number; net: number; count: number };
  netPositionInclDrafts: number;
}

interface Data {
  inbox: { newCount: number; emailCount: number; whatsappCount: number; triagedCount: number; overdueCount: number };
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
    arAging: AgingBuckets;
    apAging: AgingBuckets;
    cashFlow: CashFlow;
    topCustomers: PartyRow[];
    topSuppliers: PartyRow[];
    stuck: { overdueAr: number; overdueArCount: number; unmatchedBills: number; disputedAp: number; disputedApCount: number };
    balanceSheet: BalanceSheet;
  };
  tasks: { total: number; byType: Record<string, number> };
  stock: { itemCount: number; totalValue: number };
  activity: Array<{ job: string; startedAt: string; summary: Record<string, unknown> | null }>;
  urgentAlerts: Array<{ taskType: string; reason: string; ticketNo: number; ticketTitle: string; ticketId: string }>;
  system: { lastSync: string | null; eventsToday: number };
}

function fmt(n: number): string { return "£" + Math.round(n).toLocaleString("en-GB"); }
function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return "£" + (n / 1_000_000).toFixed(1) + "m";
  if (Math.abs(n) >= 1_000) return "£" + Math.round(n / 1_000) + "k";
  return "£" + Math.round(n);
}
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

const BUCKET_COLORS = { current: "#3399FF", d1_30: "#FFCC00", d31_60: "#FF9900", d61_plus: "#FF3333" } as const;

const STATUS_FLOW = [
  { key: "CAPTURED", label: "Captured", color: "#888" },
  { key: "PRICING", label: "Pricing", color: "#FFCC00" },
  { key: "QUOTED", label: "Quoted", color: "#3399FF" },
  { key: "APPROVED", label: "Approved", color: "#00CC66" },
  { key: "ORDERED", label: "Ordered", color: "#FF9900" },
  { key: "DELIVERED", label: "Delivered", color: "#00CC66" },
  { key: "INVOICED", label: "Invoiced", color: "#33CC66" },
];

type TabKey = "overview" | "balance-sheet";

export function CommandCentreView() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [chartMode, setChartMode] = useState<"cash" | "pnl">("cash");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pipelineFilter, setPipelineFilter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [period, setPeriod] = useState<Period>("M");

  async function load(p: Period) {
    try {
      const r = await fetch(`/api/command-centre/v2?period=${p}`, { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }

  useEffect(() => { load(period); const t = setInterval(() => load(period), 30_000); return () => clearInterval(t); }, [period]);

  if (loading) return <div className="text-sm text-[#888] p-8">Loading command centre…</div>;
  if (!data) return <div className="text-sm text-[#FF3333] p-8">Failed to load</div>;

  const d = data;
  const filteredRecent = pipelineFilter
    ? d.tickets.recent.filter((t) => t.status === pipelineFilter)
    : d.tickets.recent;

  return (
    <div className="space-y-4">
      <TabBar active={activeTab} onChange={setActiveTab} />

      {activeTab === "balance-sheet" ? (
        <div className="max-w-3xl mx-auto">
          <BalanceSheetCard bs={d.financial.balanceSheet} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
      {/* ─────── LEFT: FINANCE ─────── */}
      <div className="space-y-3">
        <ColumnHeader label="FINANCE" color="#00CC66" />

        <AgingGroupCard
          ar={{
            total: d.financial.receivables,
            count: d.financial.receivablesCount,
            aging: d.financial.arAging,
          }}
          ap={{
            total: d.financial.payables,
            count: d.financial.payablesCount,
            aging: d.financial.apAging,
          }}
        />

        <ChartCard
          flow={d.financial.cashFlow}
          mode={chartMode}
          onMode={setChartMode}
          period={period}
          onPeriod={setPeriod}
          hoverIdx={hoverIdx}
          onHover={setHoverIdx}
        />

        <PartyTable title="Top Customers · Outstanding AR" rows={d.financial.topCustomers} accent="#00CC66" hrefBase="/customers" />
        <PartyTable title="Top Suppliers · Outstanding AP" rows={d.financial.topSuppliers} accent="#FFCC00" hrefBase="/suppliers" />

        <div className="rounded-lg border border-[#FF3333]/30 bg-[#0B0B0B] p-4">
          <div className="text-[10px] uppercase tracking-widest text-[#FF3333] mb-3">Stuck Money</div>
          <StuckRow label="Overdue invoices" amount={d.financial.stuck.overdueAr} count={d.financial.stuck.overdueArCount} href="/invoices?filter=overdue" color="#FF3333" />
          <StuckRow label="Disputed bills" amount={d.financial.stuck.disputedAp} count={d.financial.stuck.disputedApCount} href="/bills?filter=disputed" color="#FF9900" />
          <StuckRow label="Unmatched bills" count={d.financial.stuck.unmatchedBills} href="/bills?filter=unmatched" color="#FFCC00" />
        </div>
      </div>

      {/* ─────── RIGHT: OPERATIONS ─────── */}
      <div className="space-y-3">
        <ColumnHeader label="OPERATIONS" color="#FF6600" />

        <div className="grid grid-cols-2 gap-3">
          <Link href="/inbox" className="rounded-lg border border-[#FF6600]/30 bg-gradient-to-br from-[#1A0A00] to-[#0D0D0D] p-3 hover:border-[#FF6600] transition-colors">
            <div className="text-[10px] uppercase tracking-widest text-[#FF6600]/70">Inbox</div>
            <div className="text-3xl font-black text-[#FF6600] mt-1 tabular-nums">{d.inbox.newCount}</div>
            <div className="text-[10px] text-[#888] mt-1">{d.inbox.emailCount} email · {d.inbox.whatsappCount} wa</div>
          </Link>
          <Link href="/inbox?status=TRIAGED" className="rounded-lg border border-[#FFCC00]/30 bg-gradient-to-br from-[#1A1500] to-[#0D0D0D] p-3 hover:border-[#FFCC00] transition-colors">
            <div className="text-[10px] uppercase tracking-widest text-[#FFCC00]/70">To Do</div>
            <div className="text-3xl font-black text-[#FFCC00] mt-1 tabular-nums">{d.inbox.triagedCount}</div>
            <div className="text-[10px] mt-1 {d.inbox.overdueCount > 0 ? 'text-[#FF3333]' : 'text-[#888]'}">
              {d.inbox.overdueCount} overdue
            </div>
          </Link>
        </div>

        {/* Pipeline */}
        <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] uppercase tracking-widest text-[#888]">Job Pipeline · {d.tickets.total} active</div>
            {pipelineFilter && (
              <button onClick={() => setPipelineFilter(null)} className="text-[10px] uppercase tracking-wider text-[#FF6600] hover:underline">
                Clear ×
              </button>
            )}
          </div>
          <div className="flex gap-1 items-end">
            {(() => {
              const total = STATUS_FLOW.reduce((s, st) => s + (d.tickets.byStatus[st.key] ?? 0), 0);
              return STATUS_FLOW.map((st) => {
                const count = d.tickets.byStatus[st.key] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                const h = count > 0 ? Math.max(28, Math.min(80, pct * 1.6)) : 8;
                const active = pipelineFilter === st.key;
                return (
                  <button key={st.key} onClick={() => setPipelineFilter(active ? null : st.key)}
                    className="flex-1 flex flex-col items-center gap-1 transition-opacity hover:opacity-90">
                    <div className="w-full rounded-t relative" style={{
                      height: h,
                      backgroundColor: count > 0 ? st.color + (active ? "55" : "20") : "#1A1A1A",
                      borderBottom: `3px solid ${count > 0 ? st.color : "#333"}`,
                      boxShadow: active ? `0 0 0 1px ${st.color}` : undefined,
                    }}>
                      {count > 0 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-sm font-black" style={{ color: st.color }}>{count}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-[9px] uppercase tracking-wider" style={{ color: active ? st.color : "#888" }}>{st.label}</div>
                  </button>
                );
              });
            })()}
          </div>
        </div>

        {/* Active tickets (filtered) */}
        <div className="rounded-lg border border-[#333] bg-[#0B0B0B] overflow-hidden">
          <div className="px-4 py-2 border-b border-[#222] flex justify-between items-center">
            <div className="text-[10px] uppercase tracking-widest text-[#888]">
              {pipelineFilter ? `Tickets · ${pipelineFilter}` : "Active Tickets"}
              {pipelineFilter && <span className="ml-2 text-[#FF6600]">{filteredRecent.length}</span>}
            </div>
            <Link href="/tickets" className="text-[10px] text-[#FF6600] hover:underline font-bold uppercase tracking-wider">View all →</Link>
          </div>
          {filteredRecent.length === 0 ? (
            <div className="p-6 text-sm text-[#666] text-center">{pipelineFilter ? "None in this stage" : "No active tickets"}</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#333] bg-[#0A0A0A]">
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">#</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Job</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Customer</th>
                  <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecent.slice(0, 10).map((t) => {
                  const sc: Record<string, string> = { CAPTURED: "#888", PRICING: "#FFCC00", QUOTED: "#3399FF", APPROVED: "#00CC66", ORDERED: "#FF9900", DELIVERED: "#00CC66", INVOICED: "#33CC66" };
                  return (
                    <tr key={t.id} className="border-b border-[#222] hover:bg-[#161616] cursor-pointer" onClick={() => window.location.href = `/tickets/${t.id}`}>
                      <td className="px-3 py-2 text-[#FF6600] font-bold">T-{t.ticketNo}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate font-medium">{t.title}</td>
                      <td className="px-3 py-2 text-[#888] max-w-[140px] truncate">{t.customer || "—"}</td>
                      <td className="px-3 py-2">
                        <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded font-bold" style={{ color: sc[t.status] ?? "#888", background: (sc[t.status] ?? "#888") + "15" }}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Tasks by type */}
        <div className="rounded-lg border border-[#FF9900]/30 bg-[#0B0B0B] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest text-[#FF9900]">Open Tasks</div>
            <span className="text-xs font-bold text-[#FF9900] tabular-nums">{d.tasks.total}</span>
          </div>
          {d.tasks.total === 0 ? (
            <div className="text-xs text-[#666] py-2 text-center">All clear</div>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(d.tasks.byType).sort(([, a], [, b]) => b - a).slice(0, 6).map(([type, count]) => {
                const colors: Record<string, string> = { BILL_NEEDS_REVIEW: "#00CCFF", SUPPLIER_DISPUTE: "#FF3333", LINK_PO: "#3399FF", REVIEW_AUTO_TICKET: "#FF9900", INVOICE_REQUIRED: "#00CC66", CHASE_PAYMENT: "#FFCC00", REVIEW_DISPUTE: "#FF3333" };
                const c = colors[type] ?? "#888";
                const max = Object.values(d.tasks.byType)[0];
                const pct = max > 0 ? (count / max) * 100 : 0;
                return (
                  <div key={type} className="text-[11px]">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[#ccc] truncate">{type.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="font-bold tabular-nums" style={{ color: c }}>{count}</span>
                    </div>
                    <div className="h-1 rounded bg-[#1A1A1A]">
                      <div className="h-1 rounded" style={{ width: pct + "%", backgroundColor: c }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Engine activity */}
        <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] uppercase tracking-widest text-[#888]">Engine Activity</div>
            <span className="text-[9px] text-[#444]">{d.system.eventsToday} events today</span>
          </div>
          {d.activity.length === 0 ? (
            <div className="text-[11px] text-[#666] py-2">No recent runs</div>
          ) : (
            <div className="space-y-1 text-[11px]">
              {d.activity.slice(0, 6).map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-[#1A1A1A] last:border-0">
                  <span className="text-[#ccc] truncate font-mono">{a.job}</span>
                  <span className="text-[#666] shrink-0 tabular-nums">{timeAgo(a.startedAt)} ago</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="text-2xl font-black text-[#ccc] tabular-nums">{d.stock.itemCount}</div>
            <div className="text-[10px] text-[#888] mt-1">Stock items</div>
          </div>
          <div>
            <div className="text-2xl font-black text-[#ccc] tabular-nums">{d.tickets.byMode.COMPETITIVE_BID ?? 0}</div>
            <div className="text-[10px] text-[#888] mt-1">Competitive</div>
          </div>
          <div>
            <div className="text-2xl font-black text-[#ccc] tabular-nums">{d.tickets.byMode.PRICING_FIRST ?? 0}</div>
            <div className="text-[10px] text-[#888] mt-1">Pricing-first</div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="col-span-2 text-[10px] text-[#444] flex justify-between px-1 pb-2">
        <span>Last sync: {d.system.lastSync ? new Date(d.system.lastSync).toLocaleString("en-GB") : "never"}</span>
        <span>Auto-refreshes every 30s</span>
      </div>
        </div>
      )}
    </div>
  );
}

function TabBar({ active, onChange }: { active: TabKey; onChange: (t: TabKey) => void }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "balance-sheet", label: "Balance Sheet" },
  ];
  return (
    <div className="flex gap-1 border-b border-[#333]">
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`px-4 py-2 text-[10px] uppercase tracking-[0.25em] font-black transition-colors ${
              on
                ? "text-[#FF6600] border-b-2 border-[#FF6600] -mb-px"
                : "text-[#888] hover:text-[#ccc]"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function ColumnHeader({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 pb-2 border-b" style={{ borderColor: color + "44" }}>
      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[11px] uppercase tracking-[0.3em] font-black" style={{ color }}>{label}</span>
    </div>
  );
}

function AgingDonut({ aging, total, accent }: { aging: AgingBuckets; total: number; accent: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const segs = [
    { v: aging.current, color: BUCKET_COLORS.current },
    { v: aging.d1_30, color: BUCKET_COLORS.d1_30 },
    { v: aging.d31_60, color: BUCKET_COLORS.d31_60 },
    { v: aging.d61_plus, color: BUCKET_COLORS.d61_plus },
  ];
  let offset = 0;
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="shrink-0">
      <circle cx="40" cy="40" r={r} fill="none" stroke="#1A1A1A" strokeWidth="10" />
      {total > 0 && segs.map((s, i) => {
        if (s.v <= 0) return null;
        const len = (s.v / total) * c;
        const dasharray = `${len} ${c - len}`;
        const dashoffset = -offset;
        offset += len;
        return (
          <circle key={i} cx="40" cy="40" r={r} fill="none" stroke={s.color} strokeWidth="10"
            strokeDasharray={dasharray} strokeDashoffset={dashoffset}
            transform="rotate(-90 40 40)" />
        );
      })}
      <text x="40" y="42" textAnchor="middle" fill={accent} fontSize="10" fontWeight="900" fontFamily="monospace">
        {fmtK(total).replace("£", "")}
      </text>
      <text x="40" y="54" textAnchor="middle" fill="#666" fontSize="7" fontFamily="monospace">TOTAL</text>
    </svg>
  );
}

function AgingGroupCard({ ar, ap }: {
  ar: { total: number; count: number; aging: AgingBuckets };
  ap: { total: number; count: number; aging: AgingBuckets };
}) {
  const net = ar.total - ap.total;
  const netColor = net >= 0 ? "#00CC66" : "#FF3333";
  return (
    <div className="rounded-lg border border-[#333] bg-[#0B0B0B] overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-[#222]">
        <AgingPanel
          title="Receivables"
          subtitle="Total Unpaid Invoices"
          total={ar.total}
          count={ar.count}
          aging={ar.aging}
          accent="#00CC66"
          hrefBase="/invoices"
        />
        <AgingPanel
          title="Payables"
          subtitle="Total Unpaid Bills"
          total={ap.total}
          count={ap.count}
          aging={ap.aging}
          accent="#FFCC00"
          hrefBase="/bills"
        />
      </div>
      <div className="border-t border-[#222] px-4 py-2 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-widest text-[#888]">Net Working Position</span>
        <span className="text-base font-black tabular-nums" style={{ color: netColor }}>
          {net < 0 ? "−" : ""}{fmt(Math.abs(net))}
        </span>
      </div>
    </div>
  );
}

function AgingPanel({ title, subtitle, total, count, aging, accent, hrefBase }: {
  title: string; subtitle: string; total: number; count: number; aging: AgingBuckets;
  accent: string; hrefBase: string;
}) {
  const overdue = aging.d1_30 + aging.d31_60 + aging.d61_plus;
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-widest text-[#888]">{title}</div>
          <div className="text-[11px] text-[#888] mt-1">{subtitle} · {count}</div>
          <div className="text-2xl font-black mt-1 tabular-nums" style={{ color: accent }}>{fmt(total)}</div>
          {overdue > 0 && (
            <div className="text-[10px] text-[#FF3333] mt-1">
              {fmt(overdue)} overdue ({total > 0 ? Math.round((overdue / total) * 100) : 0}%)
            </div>
          )}
        </div>
        <AgingDonut aging={aging} total={total} accent={accent} />
      </div>

      <div className="grid grid-cols-4 gap-1.5 mt-3 text-[10px]">
        <Link href={`${hrefBase}?bucket=current`} className="rounded p-1.5 border border-[#222] hover:border-[#3399FF] transition-colors">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BUCKET_COLORS.current }} />
            <div className="text-[#3399FF] uppercase tracking-wider font-bold text-[9px]">Current</div>
          </div>
          <div className="text-[#ccc] tabular-nums mt-0.5 text-[10px]">{fmtK(aging.current)}</div>
        </Link>
        <Link href={`${hrefBase}?bucket=1-30`} className="rounded p-1.5 border border-[#222] hover:border-[#FFCC00] transition-colors">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BUCKET_COLORS.d1_30 }} />
            <div className="text-[#FFCC00] uppercase tracking-wider font-bold text-[9px]">1-30</div>
          </div>
          <div className="text-[#ccc] tabular-nums mt-0.5 text-[10px]">{fmtK(aging.d1_30)}</div>
        </Link>
        <Link href={`${hrefBase}?bucket=31-60`} className="rounded p-1.5 border border-[#222] hover:border-[#FF9900] transition-colors">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BUCKET_COLORS.d31_60 }} />
            <div className="text-[#FF9900] uppercase tracking-wider font-bold text-[9px]">31-60</div>
          </div>
          <div className="text-[#ccc] tabular-nums mt-0.5 text-[10px]">{fmtK(aging.d31_60)}</div>
        </Link>
        <Link href={`${hrefBase}?bucket=61+`} className="rounded p-1.5 border border-[#222] hover:border-[#FF3333] transition-colors">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BUCKET_COLORS.d61_plus }} />
            <div className="text-[#FF3333] uppercase tracking-wider font-bold text-[9px]">61+</div>
          </div>
          <div className="text-[#ccc] tabular-nums mt-0.5 text-[10px]">{fmtK(aging.d61_plus)}</div>
        </Link>
      </div>
    </div>
  );
}

function BalanceSheetCard({ bs }: { bs: BalanceSheet }) {
  const positive = bs.netPositionInclDrafts >= 0;
  return (
    <div className="rounded-lg border border-[#FF6600]/40 bg-[#0B0B0B] p-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#222]">
        <div className="text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">Net Position · Balance Sheet</div>
        <span className="text-[9px] text-[#666]">posted journals only</span>
      </div>

      <BSGroup label="Current Assets" accent="#00CC66">
        {bs.cash.lines.map((l) => <BSRow key={l.code} code={l.code} name={l.name} amount={l.amount} />)}
        {bs.cash.lines.length > 1 && <BSRow code="" name="Total cash at bank" amount={bs.cash.total} subtle bold />}
        {bs.ar.gross !== 0 && <BSRow code="1100" name="Accounts Receivable" amount={bs.ar.gross} exVat={bs.ar.net} />}
        {bs.otherDebtors.lines.map((l) => <BSRow key={l.code} code={l.code} name={l.name} amount={l.amount} />)}
        {bs.otherCurrentAssets.lines.map((l) => <BSRow key={l.code} code={l.code} name={l.name} amount={l.amount} />)}
        <BSRow code="" name="Total Current Assets" amount={bs.totalCurrentAssets} bold accent="#00CC66" />
      </BSGroup>

      <BSGroup label="Current Liabilities" accent="#FF9900">
        {bs.ap.gross !== 0 && <BSRow code="2000" name="Accounts Payable" amount={-bs.ap.gross} exVat={-bs.ap.net} />}
        {bs.otherCurrentLiabilities.lines.map((l) => <BSRow key={l.code} code={l.code} name={l.name} amount={-l.amount} />)}
        <BSRow code="" name="Total Current Liabilities" amount={-bs.totalCurrentLiabilities} bold accent="#FF9900" />
      </BSGroup>

      <div className="border-t border-[#FF6600]/40 pt-2 mt-2">
        <BSRow code="" name="Net Current Assets" amount={bs.netCurrentAssets} bold accent={bs.netCurrentAssets >= 0 ? "#00CC66" : "#FF3333"} />
      </div>

      {bs.draftInvoices.count > 0 && (
        <div className="border-t border-[#222] pt-2 mt-2">
          <BSRow
            code=""
            name={`Draft Invoices (${bs.draftInvoices.count}, not yet posted)`}
            amount={bs.draftInvoices.gross}
            exVat={bs.draftInvoices.net}
            accent="#888"
          />
        </div>
      )}

      <div className="bg-[#FF6600]/10 border border-[#FF6600]/40 rounded mt-3 px-3 py-2 flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-widest font-bold text-[#FF6600]">
          {bs.draftInvoices.count > 0 ? "Net Position incl. Drafts" : "Net Position"}
        </span>
        <span className="text-xl font-black tabular-nums" style={{ color: positive ? "#00CC66" : "#FF3333" }}>
          {positive ? "" : "−"}{fmt(Math.abs(bs.netPositionInclDrafts))}
        </span>
      </div>
    </div>
  );
}

function BSGroup({ label, accent, children }: { label: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="text-[9px] uppercase tracking-widest font-bold mb-1" style={{ color: accent }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function BSRow({ code, name, amount, exVat, bold, subtle, accent }: { code: string; name: string; amount: number; exVat?: number; bold?: boolean; subtle?: boolean; accent?: string }) {
  const valColor = accent ?? (amount < 0 ? "#FF9900" : "#ccc");
  return (
    <div className={`flex items-baseline justify-between py-0.5 text-[11px] ${subtle ? "opacity-70" : ""}`}>
      <div className="flex items-baseline gap-2 min-w-0">
        {code && <span className="text-[#666] font-mono w-10 shrink-0">{code}</span>}
        {!code && <span className="w-10 shrink-0" />}
        <span className={`truncate ${bold ? "font-bold text-[#E0E0E0]" : "text-[#bbb]"}`}>{name}</span>
      </div>
      <div className="flex items-baseline gap-2 shrink-0">
        {exVat !== undefined && (
          <span className="text-[9px] text-[#666] tabular-nums">ex VAT {fmt(Math.abs(exVat))}</span>
        )}
        <span className={`tabular-nums ${bold ? "font-bold" : ""}`} style={{ color: valColor }}>
          {amount < 0 ? "−" : ""}{fmt(Math.abs(amount))}
        </span>
      </div>
    </div>
  );
}

const PERIOD_LABEL: Record<Period, string> = { Y: "Yearly", M: "Monthly", W: "Weekly", D: "Daily" };

function ChartCard({ flow, mode, onMode, period, onPeriod, hoverIdx, onHover }: {
  flow: CashFlow;
  mode: "cash" | "pnl"; onMode: (m: "cash" | "pnl") => void;
  period: Period; onPeriod: (p: Period) => void;
  hoverIdx: number | null; onHover: (i: number | null) => void;
}) {
  const W = 600;
  const H = 200;
  const PAD = { l: 50, r: 12, t: 16, b: 26 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const buckets = flow.buckets;
  const n = buckets.length;
  const xStep = innerW / Math.max(1, n - 1);
  const todayIdx = buckets.findIndex((b) => b.key === flow.todayKey);

  // Series (3 in P&L mode, 2 in Cash mode)
  const seriesIncome = mode === "cash"
    ? buckets.map((b) => b.cashIn)
    : buckets.map((b) => b.pnlIncome);
  const seriesCogs = mode === "cash"
    ? buckets.map((b) => b.cashOut)
    : buckets.map((b) => b.pnlCogs);
  const seriesExpenses = mode === "pnl"
    ? buckets.map((b) => b.pnlExpenses)
    : null;

  const allSeries = seriesExpenses ? [seriesIncome, seriesCogs, seriesExpenses] : [seriesIncome, seriesCogs];
  const max = Math.max(1, ...allSeries.flat());
  const niceMax = niceCeil(max);

  function buildPaths(series: number[]) {
    // Split into past (solid) and future (dashed) at todayIdx
    const splitAt = Math.max(0, Math.min(n, todayIdx));
    const segs: { from: number; to: number; future: boolean }[] = [];
    if (splitAt > 0) segs.push({ from: 0, to: splitAt - 1, future: false });
    if (splitAt < n) segs.push({ from: Math.max(0, splitAt - 1), to: n - 1, future: true });
    return segs.map((s) => {
      let d = "";
      for (let i = s.from; i <= s.to; i++) {
        const x = PAD.l + i * xStep;
        const y = PAD.t + innerH - (series[i] / niceMax) * innerH;
        d += (i === s.from ? "M " : "L ") + x + " " + y + " ";
      }
      return { d, future: s.future };
    });
  }

  const incomePaths = buildPaths(seriesIncome);
  const cogsPaths = buildPaths(seriesCogs);
  const expensesPaths = seriesExpenses ? buildPaths(seriesExpenses) : null;

  const colorIncome = "#00CC66";
  const colorCogs = "#FF9900";
  const colorExpenses = "#FFCC00";

  const totalIncome = seriesIncome.reduce((a, b) => a + b, 0);
  const totalCogs = seriesCogs.reduce((a, b) => a + b, 0);
  const totalExpenses = seriesExpenses ? seriesExpenses.reduce((a, b) => a + b, 0) : 0;
  const net = totalIncome - totalCogs - totalExpenses;

  const ticks = useMemo(() => {
    const arr: number[] = [];
    for (let i = 0; i <= 4; i++) arr.push((niceMax / 4) * i);
    return arr;
  }, [niceMax]);

  const hover = hoverIdx !== null ? buckets[hoverIdx] : null;
  const labelTotal = `${n} ${period === "Y" ? "y" : period === "M" ? "mo" : period === "W" ? "wk" : "d"}`;
  const periods: Period[] = ["Y", "M", "W", "D"];

  return (
    <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-4">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-[10px] uppercase tracking-widest text-[#888]">
          {mode === "cash" ? "Cash Flow" : "P&L · Income vs COGS vs Expenses"} · {PERIOD_LABEL[period]}
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <div className="flex gap-1">
            {periods.map((p) => (
              <button key={p} onClick={() => onPeriod(p)}
                className={`w-6 py-0.5 rounded uppercase tracking-wider font-bold ${period === p ? "bg-[#3399FF] text-black" : "text-[#888] hover:text-white"}`}>
                {p}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <button onClick={() => onMode("cash")}
              className={`px-2 py-0.5 rounded uppercase tracking-wider font-bold ${mode === "cash" ? "bg-[#FF6600] text-black" : "text-[#888] hover:text-white"}`}>
              Cash
            </button>
            <button onClick={() => onMode("pnl")}
              className={`px-2 py-0.5 rounded uppercase tracking-wider font-bold ${mode === "pnl" ? "bg-[#FF6600] text-black" : "text-[#888] hover:text-white"}`}>
              P&L
            </button>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none"
        onMouseLeave={() => onHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W - PAD.l;
          const i = Math.round(x / xStep);
          if (i >= 0 && i < n) onHover(i); else onHover(null);
        }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH - (t / niceMax) * innerH} y2={PAD.t + innerH - (t / niceMax) * innerH} stroke="#1F1F1F" strokeWidth="1" />
            <text x={PAD.l - 6} y={PAD.t + innerH - (t / niceMax) * innerH + 3} fill="#555" fontSize="9" textAnchor="end" fontFamily="monospace">{fmtK(t)}</text>
          </g>
        ))}

        {/* Today marker */}
        {todayIdx >= 0 && todayIdx < n && (
          <line x1={PAD.l + todayIdx * xStep} x2={PAD.l + todayIdx * xStep} y1={PAD.t} y2={PAD.t + innerH}
            stroke="#FF6600" strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
        )}

        {/* Lines */}
        {incomePaths.map((p, i) => (
          <path key={"i" + i} d={p.d} fill="none" stroke={colorIncome} strokeWidth="2" strokeDasharray={p.future ? "4 3" : undefined} />
        ))}
        {cogsPaths.map((p, i) => (
          <path key={"c" + i} d={p.d} fill="none" stroke={colorCogs} strokeWidth="2" strokeDasharray={p.future ? "4 3" : undefined} />
        ))}
        {expensesPaths && expensesPaths.map((p, i) => (
          <path key={"e" + i} d={p.d} fill="none" stroke={colorExpenses} strokeWidth="2" strokeDasharray={p.future ? "4 3" : undefined} />
        ))}

        {/* Dots */}
        {buckets.map((_, i) => (
          <g key={i}>
            <circle cx={PAD.l + i * xStep} cy={PAD.t + innerH - (seriesIncome[i] / niceMax) * innerH} r={hoverIdx === i ? 4 : 2.5} fill={colorIncome} />
            <circle cx={PAD.l + i * xStep} cy={PAD.t + innerH - (seriesCogs[i] / niceMax) * innerH} r={hoverIdx === i ? 4 : 2.5} fill={colorCogs} />
            {seriesExpenses && (
              <circle cx={PAD.l + i * xStep} cy={PAD.t + innerH - (seriesExpenses[i] / niceMax) * innerH} r={hoverIdx === i ? 4 : 2.5} fill={colorExpenses} />
            )}
          </g>
        ))}

        {/* Hover crosshair */}
        {hoverIdx !== null && (
          <line x1={PAD.l + hoverIdx * xStep} x2={PAD.l + hoverIdx * xStep} y1={PAD.t} y2={PAD.t + innerH} stroke="#666" strokeWidth="1" strokeDasharray="2 2" />
        )}

        {/* X labels — show every Nth */}
        {buckets.map((b, i) => {
          const skip = n > 24 ? 4 : n > 12 ? 2 : 1;
          if (i % skip !== 0) return null;
          return (
            <text key={i} x={PAD.l + i * xStep} y={H - 6} fill={i === todayIdx ? "#FF6600" : "#666"} fontSize="8" textAnchor="middle" fontFamily="monospace">
              {b.label}
            </text>
          );
        })}
      </svg>

      {/* Totals row */}
      <div className={`grid ${mode === "pnl" ? "grid-cols-4" : "grid-cols-3"} gap-2 mt-3 text-[11px] pt-2 border-t border-[#222]`}>
        <div>
          <div className="text-[9px] text-[#888] uppercase">{hover ? hover.label : labelTotal} · {mode === "cash" ? "Cash In" : "Income"}</div>
          <div className="font-bold tabular-nums" style={{ color: colorIncome }}>+{fmt(hover ? seriesIncome[hoverIdx!] : totalIncome)}</div>
        </div>
        <div>
          <div className="text-[9px] text-[#888] uppercase">{hover ? hover.label : labelTotal} · {mode === "cash" ? "Cash Out" : "COGS"}</div>
          <div className="font-bold tabular-nums" style={{ color: colorCogs }}>−{fmt(hover ? seriesCogs[hoverIdx!] : totalCogs)}</div>
        </div>
        {mode === "pnl" && seriesExpenses && (
          <div>
            <div className="text-[9px] text-[#888] uppercase">{hover ? hover.label : labelTotal} · Expenses</div>
            <div className="font-bold tabular-nums" style={{ color: colorExpenses }}>−{fmt(hover ? seriesExpenses[hoverIdx!] : totalExpenses)}</div>
          </div>
        )}
        <div>
          <div className="text-[9px] text-[#888] uppercase">Net</div>
          <div className="font-bold tabular-nums" style={{ color: (hover ? (seriesIncome[hoverIdx!] - seriesCogs[hoverIdx!] - (seriesExpenses ? seriesExpenses[hoverIdx!] : 0)) : net) >= 0 ? "#00CC66" : "#FF3333" }}>
            {fmt(hover ? (seriesIncome[hoverIdx!] - seriesCogs[hoverIdx!] - (seriesExpenses ? seriesExpenses[hoverIdx!] : 0)) : net)}
          </div>
        </div>
      </div>

      {/* Insights drilldown */}
      {hover && mode === "pnl" && (hover.insights.topIncome.length + hover.insights.topCogs.length + hover.insights.topExpenses.length > 0) && (
        <div className="mt-3 pt-2 border-t border-[#222] grid grid-cols-3 gap-3 text-[10px]">
          <InsightColumn title="Income" rows={hover.insights.topIncome} color={colorIncome} />
          <InsightColumn title="COGS" rows={hover.insights.topCogs} color={colorCogs} />
          <InsightColumn title="Expenses" rows={hover.insights.topExpenses} color={colorExpenses} />
        </div>
      )}
    </div>
  );
}

function InsightColumn({ title, rows, color }: { title: string; rows: Contributor[]; color: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color }}>{title}</div>
      {rows.length === 0 ? (
        <div className="text-[10px] text-[#555]">—</div>
      ) : (
        <div className="space-y-0.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[10px]">
              <span className="text-[#bbb] truncate pr-2">{r.name}</span>
              <span className="tabular-nums" style={{ color }}>{fmtK(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StuckRow({ label, amount, count, href, color }: { label: string; amount?: number; count: number; href: string; color: string }) {
  if (count === 0) return null;
  return (
    <Link href={href} className="flex items-center justify-between py-1.5 border-b border-[#222] last:border-0 hover:bg-[#161616] px-2 -mx-2 rounded">
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[11px] text-[#ccc]">{label}</span>
      </div>
      <div className="flex items-center gap-2 text-[11px] tabular-nums">
        {amount !== undefined && <span style={{ color }}>{fmtK(amount)}</span>}
        <span className="text-[#666] bg-[#1A1A1A] px-1.5 py-0.5 rounded text-[10px]">{count}</span>
      </div>
    </Link>
  );
}

function PartyTable({ title, rows, accent, hrefBase }: { title: string; rows: PartyRow[]; accent: string; hrefBase: string }) {
  return (
    <div className="rounded-lg border border-[#333] bg-[#0B0B0B] p-4">
      <div className="text-[10px] uppercase tracking-widest text-[#888] mb-3">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-[#666] py-2">No outstanding amounts</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => {
            const max = rows[0]?.amount ?? 1;
            const pct = max > 0 ? (r.amount / max) * 100 : 0;
            return (
              <Link key={r.id} href={`${hrefBase}/${r.id}`} className="block py-1 hover:bg-[#161616] rounded px-2 -mx-2">
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-[#ccc] truncate font-medium">{i + 1}. {r.name}</span>
                  <span className="tabular-nums font-bold" style={{ color: accent }}>{fmtK(r.amount)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 rounded bg-[#1A1A1A]">
                    <div className="h-1 rounded" style={{ width: pct + "%", backgroundColor: accent }} />
                  </div>
                  <span className="text-[9px] text-[#666] tabular-nums">{r.count}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / exp;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * exp;
}

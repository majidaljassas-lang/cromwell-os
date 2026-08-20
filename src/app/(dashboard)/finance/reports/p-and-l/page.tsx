import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

type GroupMode = "account" | "day" | "week" | "month" | "year" | "customer" | "site" | "supplier" | "ticket";
const TIME_GROUPS: GroupMode[] = ["day", "week", "month", "year"];
const ENTITY_GROUPS: GroupMode[] = ["customer", "site", "supplier", "ticket"];
const ALL_GROUPS: GroupMode[] = ["account", ...TIME_GROUPS, ...ENTITY_GROUPS];

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + "k";
  return Math.round(n).toString();
}
function pct(part: number, whole: number): string {
  if (!whole) return "—";
  return ((part / whole) * 100).toFixed(1) + "%";
}

function defaultPeriodBounds(): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)),
    to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)),
  };
}

function bucketKey(d: Date, mode: GroupMode): { key: string; label: string; sort: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (mode === "day") {
    const k = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { key: k, label: k, sort: k };
  }
  if (mode === "week") {
    const monday = new Date(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7)));
    const k = `${monday.getUTCFullYear()}-W${String(Math.ceil((((+monday - +new Date(Date.UTC(monday.getUTCFullYear(), 0, 1))) / 86400000) + 1) / 7)).padStart(2, "0")}`;
    const lab = monday.toISOString().slice(0, 10);
    return { key: k, label: `wk ${lab}`, sort: lab };
  }
  if (mode === "month") {
    const k = `${y}-${String(m + 1).padStart(2, "0")}`;
    const lab = new Date(Date.UTC(y, m, 1)).toLocaleString("en-GB", { month: "short", year: "2-digit" });
    return { key: k, label: lab, sort: k };
  }
  if (mode === "year") {
    return { key: String(y), label: String(y), sort: String(y) };
  }
  return { key: "", label: "", sort: "" };
}

interface PivotRow {
  key: string;
  label: string;
  sort: string;
  revenue: number;
  cogs: number;
  opex: number;
  drillHref?: string;
}

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    customerId?: string;
    siteId?: string;
    ticketId?: string;
    supplierId?: string;
    groupBy?: string;
  }>;
}) {
  const params = await searchParams;
  const defaults = defaultPeriodBounds();
  const from = params.from ? new Date(params.from) : defaults.from;
  const to = params.to ? new Date(`${params.to}T23:59:59.999Z`) : defaults.to;
  const groupBy = (ALL_GROUPS.includes(params.groupBy as GroupMode) ? params.groupBy : "account") as GroupMode;

  const lineFilter: Record<string, unknown> = {
    journalEntry: { entryDate: { gte: from, lte: to }, status: "POSTED" },
  };
  if (params.customerId) lineFilter.customerId = params.customerId;
  if (params.siteId) lineFilter.siteId = params.siteId;
  if (params.ticketId) lineFilter.ticketId = params.ticketId;
  if (params.supplierId) lineFilter.supplierId = params.supplierId;

  const fromStr = from.toISOString().slice(0, 10);
  const toStr = to.toISOString().slice(0, 10);

  const filterParams = new URLSearchParams();
  filterParams.set("from", fromStr);
  filterParams.set("to", toStr);
  if (params.customerId) filterParams.set("customerId", params.customerId);
  if (params.siteId) filterParams.set("siteId", params.siteId);
  if (params.ticketId) filterParams.set("ticketId", params.ticketId);
  if (params.supplierId) filterParams.set("supplierId", params.supplierId);

  // ── ACCOUNT MODE: legacy view, keeps drill-through ────────────────────────
  if (groupBy === "account") {
    const grouped = await prisma.journalLine.groupBy({
      by: ["accountId"],
      where: lineFilter,
      _sum: { debit: true, credit: true },
    });
    const accounts = await prisma.chartOfAccount.findMany({ where: { id: { in: grouped.map((g) => g.accountId) } } });
    const acctById = new Map(accounts.map((a) => [a.id, a]));

    type Row = { accountId: string; code: string; name: string; type: string; net: number };
    const incomeRows: Row[] = [];
    const cogsRows: Row[] = [];
    const opexRows: Row[] = [];
    for (const g of grouped) {
      const a = acctById.get(g.accountId);
      if (!a) continue;
      const debit = Number(g._sum.debit ?? 0);
      const credit = Number(g._sum.credit ?? 0);
      if (a.accountType === "INCOME") {
        const net = credit - debit;
        if (net !== 0) incomeRows.push({ accountId: a.id, code: a.accountCode, name: a.accountName, type: a.accountType, net });
      } else if (a.accountType === "EXPENSE") {
        const net = debit - credit;
        if (net !== 0) {
          const r = { accountId: a.id, code: a.accountCode, name: a.accountName, type: a.accountType, net };
          if (a.accountSubType === "COST_OF_GOODS_SOLD") cogsRows.push(r);
          else opexRows.push(r);
        }
      }
    }
    incomeRows.sort((a, b) => a.code.localeCompare(b.code));
    cogsRows.sort((a, b) => a.code.localeCompare(b.code));
    opexRows.sort((a, b) => a.code.localeCompare(b.code));
    const totalIncome = incomeRows.reduce((s, r) => s + r.net, 0);
    const totalCogs = cogsRows.reduce((s, r) => s + r.net, 0);
    const grossProfit = totalIncome - totalCogs;
    const totalOpex = opexRows.reduce((s, r) => s + r.net, 0);
    const netProfit = grossProfit - totalOpex;
    const drillUrl = (accountId: string) => `/finance/reports/general-ledger?accountId=${accountId}&${filterParams.toString()}`;

    const invoiceStatus = await fetchInvoiceStatus(from, to, params.customerId, params.siteId);

    return (
      <div className="p-4 space-y-4">
        <Header fromStr={fromStr} toStr={toStr} />
        <FilterForm fromStr={fromStr} toStr={toStr} params={params} groupBy={groupBy} />
        <KPIRow totalIncome={totalIncome} totalCogs={totalCogs} grossProfit={grossProfit} totalOpex={totalOpex} netProfit={netProfit} />
        <InvoiceStatusPanel data={invoiceStatus} fromStr={fromStr} toStr={toStr} />

        <Section title="REVENUE" rows={incomeRows} accent="#00CC66" drillUrl={drillUrl} />
        <SubTotal label="TOTAL REVENUE" value={totalIncome} accent="#00CC66" />
        <Section title="COST OF SALES" rows={cogsRows} accent="#FF9900" drillUrl={drillUrl} />
        <SubTotal label="TOTAL COGS" value={totalCogs} accent="#FF9900" />
        <SubTotal label="GROSS PROFIT" value={grossProfit} accent="#FF6600" emphasis />
        <Section title="OPERATING EXPENSES" rows={opexRows} accent="#FF3333" drillUrl={drillUrl} />
        <SubTotal label="TOTAL OPEX" value={totalOpex} accent="#FF3333" />
        <SubTotal label="NET PROFIT" value={netProfit} accent="#FF6600" emphasis />
      </div>
    );
  }

  // ── PIVOT MODES ──────────────────────────────────────────────────────────
  const buckets = new Map<string, PivotRow>();
  const ensure = (key: string, label: string, sort: string) => {
    let b = buckets.get(key);
    if (!b) { b = { key, label, sort, revenue: 0, cogs: 0, opex: 0 }; buckets.set(key, b); }
    return b;
  };

  if (TIME_GROUPS.includes(groupBy)) {
    const lines = await prisma.journalLine.findMany({
      where: lineFilter,
      select: {
        debit: true, credit: true,
        journalEntry: { select: { entryDate: true } },
        account: { select: { accountType: true, accountSubType: true } },
      },
    });
    for (const l of lines) {
      const { key, label, sort } = bucketKey(l.journalEntry.entryDate, groupBy);
      const b = ensure(key, label, sort);
      const debit = Number(l.debit);
      const credit = Number(l.credit);
      const at = l.account.accountType;
      const ast = l.account.accountSubType;
      if (at === "INCOME") b.revenue += credit - debit;
      else if (at === "EXPENSE") {
        if (ast === "COST_OF_GOODS_SOLD") b.cogs += debit - credit;
        else b.opex += debit - credit;
      }
    }
  } else {
    // ENTITY GROUPS — group by [dim, accountId] then bucket
    const dimField = groupBy === "customer" ? "customerId"
      : groupBy === "site" ? "siteId"
      : groupBy === "supplier" ? "supplierId"
      : "ticketId";
    type GroupRow = { [k: string]: string | null } & { accountId: string; _sum: { debit: unknown; credit: unknown } };
    const grouped = await prisma.journalLine.groupBy({
      by: [dimField as never, "accountId"],
      where: { ...lineFilter, [dimField]: { not: null } },
      _sum: { debit: true, credit: true },
    });
    const accountIds = [...new Set((grouped as GroupRow[]).map((g) => g.accountId))];
    const accounts = await prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, accountType: true, accountSubType: true },
    });
    const acctMap = new Map(accounts.map((a) => [a.id, a]));

    const ids = [...new Set((grouped as GroupRow[]).map((g) => g[dimField]).filter((x): x is string => !!x))];
    const labelMap = new Map<string, string>();
    if (groupBy === "customer") {
      const rows = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      for (const r of rows) labelMap.set(r.id, r.name);
    } else if (groupBy === "site") {
      const rows = await prisma.site.findMany({ where: { id: { in: ids } }, select: { id: true, siteName: true } });
      for (const r of rows) labelMap.set(r.id, r.siteName);
    } else if (groupBy === "supplier") {
      const rows = await prisma.supplier.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      for (const r of rows) labelMap.set(r.id, r.name);
    } else if (groupBy === "ticket") {
      const rows = await prisma.ticket.findMany({ where: { id: { in: ids } }, select: { id: true, ticketNo: true, title: true } });
      for (const r of rows) labelMap.set(r.id, `T-${r.ticketNo} · ${r.title}`);
    }

    for (const g of grouped as GroupRow[]) {
      const id = g[dimField];
      if (!id) continue;
      const acct = acctMap.get(g.accountId);
      if (!acct) continue;
      const debit = Number(g._sum.debit ?? 0);
      const credit = Number(g._sum.credit ?? 0);
      const label = labelMap.get(id) ?? "(unknown)";
      const b = ensure(id, label, label);
      b.drillHref = drillFilterFor(groupBy, id, fromStr, toStr, params);
      if (acct.accountType === "INCOME") b.revenue += credit - debit;
      else if (acct.accountType === "EXPENSE") {
        if (acct.accountSubType === "COST_OF_GOODS_SOLD") b.cogs += debit - credit;
        else b.opex += debit - credit;
      }
    }
  }

  let rows = [...buckets.values()];
  rows.sort((a, b) => {
    if (TIME_GROUPS.includes(groupBy)) return a.sort.localeCompare(b.sort);
    return (b.revenue - b.cogs - b.opex) - (a.revenue - a.cogs - a.opex);
  });

  const totalIncome = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = rows.reduce((s, r) => s + r.cogs, 0);
  const totalOpex = rows.reduce((s, r) => s + r.opex, 0);
  const grossProfit = totalIncome - totalCogs;
  const netProfit = grossProfit - totalOpex;

  const invoiceStatus = await fetchInvoiceStatus(from, to, params.customerId, params.siteId);

  return (
    <div className="p-4 space-y-4">
      <Header fromStr={fromStr} toStr={toStr} />
      <FilterForm fromStr={fromStr} toStr={toStr} params={params} groupBy={groupBy} />
      <KPIRow totalIncome={totalIncome} totalCogs={totalCogs} grossProfit={grossProfit} totalOpex={totalOpex} netProfit={netProfit} />
      <InvoiceStatusPanel data={invoiceStatus} fromStr={fromStr} toStr={toStr} />

      {TIME_GROUPS.includes(groupBy) && rows.length > 0 && (
        <PivotChart rows={rows} />
      )}

      <PivotTable rows={rows} groupBy={groupBy} />
      <SubTotal label="GROSS PROFIT" value={grossProfit} accent="#FF6600" emphasis />
      <SubTotal label="NET PROFIT" value={netProfit} accent="#FF6600" emphasis />
    </div>
  );
}

function drillFilterFor(mode: GroupMode, id: string, from: string, to: string, params: { customerId?: string; siteId?: string; ticketId?: string; supplierId?: string }): string {
  const q = new URLSearchParams();
  q.set("from", from); q.set("to", to);
  q.set("groupBy", "account");
  if (mode === "customer") q.set("customerId", id);
  else if (mode === "site") q.set("siteId", id);
  else if (mode === "supplier") q.set("supplierId", id);
  else if (mode === "ticket") q.set("ticketId", id);
  if (params.customerId && mode !== "customer") q.set("customerId", params.customerId);
  if (params.siteId && mode !== "site") q.set("siteId", params.siteId);
  if (params.supplierId && mode !== "supplier") q.set("supplierId", params.supplierId);
  if (params.ticketId && mode !== "ticket") q.set("ticketId", params.ticketId);
  return `/finance/reports/p-and-l?${q.toString()}`;
}

async function fetchInvoiceStatus(from: Date, to: Date, customerId?: string, siteId?: string) {
  const baseWhere: Record<string, unknown> = {};
  if (customerId) baseWhere.customerId = customerId;
  if (siteId) baseWhere.siteId = siteId;

  const [draftAll, byStatus] = await Promise.all([
    prisma.salesInvoice.aggregate({
      where: { ...baseWhere, status: "DRAFT" },
      _sum: { totalSell: true },
      _count: true,
    }),
    prisma.salesInvoice.groupBy({
      by: ["status"],
      where: { ...baseWhere, status: { not: "DRAFT" }, issuedAt: { gte: from, lte: to } },
      _sum: { totalSell: true },
      _count: true,
    }),
  ]);

  const map: Record<string, { count: number; total: number }> = {
    DRAFT: { count: draftAll._count, total: Number(draftAll._sum.totalSell ?? 0) },
  };
  for (const s of byStatus) {
    map[s.status] = { count: s._count, total: Number(s._sum.totalSell ?? 0) };
  }
  return map;
}

function Header({ fromStr, toStr }: { fromStr: string; toStr: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">PROFIT &amp; LOSS</h1>
      <div className="text-[11px] text-[#888888] uppercase tracking-widest">{fromStr} → {toStr}</div>
    </div>
  );
}

function FilterForm({ fromStr, toStr, params, groupBy }: { fromStr: string; toStr: string; params: { customerId?: string; siteId?: string; ticketId?: string; supplierId?: string }; groupBy: GroupMode }) {
  return (
    <form className="flex gap-2 items-end text-[11px] flex-wrap" method="get">
      <Field label="From" name="from" defaultValue={fromStr} type="date" />
      <Field label="To" name="to" defaultValue={toStr} type="date" />
      <Select label="Group by" name="groupBy" defaultValue={groupBy} options={[
        { value: "account", label: "Account (default)" },
        { value: "day", label: "Day" },
        { value: "week", label: "Week" },
        { value: "month", label: "Month" },
        { value: "year", label: "Year" },
        { value: "customer", label: "Customer" },
        { value: "site", label: "Site" },
        { value: "supplier", label: "Supplier" },
        { value: "ticket", label: "Ticket" },
      ]} />
      <Field label="Customer ID" name="customerId" defaultValue={params.customerId ?? ""} />
      <Field label="Site ID" name="siteId" defaultValue={params.siteId ?? ""} />
      <Field label="Supplier ID" name="supplierId" defaultValue={params.supplierId ?? ""} />
      <Field label="Ticket ID" name="ticketId" defaultValue={params.ticketId ?? ""} />
      <button type="submit" className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold">Apply</button>
    </form>
  );
}

function KPIRow({ totalIncome, totalCogs, grossProfit, totalOpex, netProfit }: { totalIncome: number; totalCogs: number; grossProfit: number; totalOpex: number; netProfit: number }) {
  const margin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
  return (
    <div className="grid grid-cols-6 gap-2">
      <KPI label="Revenue" value={totalIncome} color="#00CC66" />
      <KPI label="COGS" value={totalCogs} color="#FF9900" sign="-" />
      <KPI label="Gross profit" value={grossProfit} color="#FF6600" />
      <KPI label="Opex" value={totalOpex} color="#FF3333" sign="-" />
      <KPI label="Net profit" value={netProfit} color={netProfit >= 0 ? "#00CC66" : "#FF3333"} />
      <KPI label="Net margin" value={margin} color={netProfit >= 0 ? "#00CC66" : "#FF3333"} suffix="%" decimals={1} />
    </div>
  );
}

function KPI({ label, value, color, sign, suffix, decimals }: { label: string; value: number; color: string; sign?: string; suffix?: string; decimals?: number }) {
  return (
    <div className="border border-[#333] bg-[#0B0B0B] rounded p-3">
      <div className="text-[9px] uppercase tracking-widest text-[#888]">{label}</div>
      <div className="text-base font-black tabular-nums mt-1" style={{ color }}>
        {sign}
        {suffix === "%" ? value.toFixed(decimals ?? 0) : "£" + value.toLocaleString("en-GB", { minimumFractionDigits: decimals ?? 0, maximumFractionDigits: decimals ?? 0 })}
        {suffix === "%" ? "%" : ""}
      </div>
    </div>
  );
}

function InvoiceStatusPanel({ data, fromStr, toStr }: { data: Record<string, { count: number; total: number }>; fromStr: string; toStr: string }) {
  const order: Array<{ key: string; label: string; color: string; allTime?: boolean }> = [
    { key: "DRAFT", label: "Draft (all)", color: "#888", allTime: true },
    { key: "SENT", label: "Sent", color: "#3399FF" },
    { key: "UNPAID", label: "Unpaid", color: "#FFCC00" },
    { key: "PAID", label: "Paid", color: "#00CC66" },
  ];
  return (
    <div className="border border-[#333] bg-[#0B0B0B] rounded">
      <div className="px-4 py-2 border-b border-[#222] flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-[#888]">Invoice Status</span>
        <span className="text-[10px] text-[#666]">period {fromStr} → {toStr} (drafts: all-time, no date)</span>
      </div>
      <div className="grid grid-cols-4">
        {order.map((s) => {
          const d = data[s.key] ?? { count: 0, total: 0 };
          return (
            <Link key={s.key} href={`/invoices?status=${s.key}`}
              className="px-4 py-3 border-r border-[#222] last:border-r-0 hover:bg-[#161616]">
              <div className="text-[9px] uppercase tracking-widest font-bold" style={{ color: s.color }}>{s.label}</div>
              <div className="text-lg font-black tabular-nums mt-1" style={{ color: s.color }}>£{fmtK(d.total)}</div>
              <div className="text-[10px] text-[#888] tabular-nums mt-0.5">{d.count} doc{d.count === 1 ? "" : "s"}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function PivotChart({ rows }: { rows: PivotRow[] }) {
  const W = 1100;
  const H = 180;
  const PAD = { l: 56, r: 16, t: 16, b: 30 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.cogs + r.opex)));
  const niceMax = niceCeil(max);
  const xStep = innerW / Math.max(1, rows.length - 1);

  const revenuePath = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${PAD.l + i * xStep} ${PAD.t + innerH - (r.revenue / niceMax) * innerH}`).join(" ");
  const costPath = rows.map((r, i) => `${i === 0 ? "M" : "L"} ${PAD.l + i * xStep} ${PAD.t + innerH - ((r.cogs + r.opex) / niceMax) * innerH}`).join(" ");
  const fillRevenue = `${revenuePath} L ${PAD.l + (rows.length - 1) * xStep} ${PAD.t + innerH} L ${PAD.l} ${PAD.t + innerH} Z`;

  const ticks: number[] = [];
  for (let i = 0; i <= 4; i++) ticks.push((niceMax / 4) * i);

  return (
    <div className="border border-[#333] bg-[#0B0B0B] rounded p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + innerH - (t / niceMax) * innerH} y2={PAD.t + innerH - (t / niceMax) * innerH} stroke="#1F1F1F" strokeWidth="1" />
            <text x={PAD.l - 8} y={PAD.t + innerH - (t / niceMax) * innerH + 3} fill="#555" fontSize="9" textAnchor="end" fontFamily="monospace">£{fmtK(t)}</text>
          </g>
        ))}
        <path d={fillRevenue} fill="#00CC66" fillOpacity="0.08" />
        <path d={revenuePath} fill="none" stroke="#00CC66" strokeWidth="2" />
        <path d={costPath} fill="none" stroke="#FF6633" strokeWidth="2" strokeDasharray="3 3" />
        {rows.map((r, i) => {
          const showLabel = rows.length <= 24 || i % Math.ceil(rows.length / 24) === 0;
          return showLabel ? (
            <text key={i} x={PAD.l + i * xStep} y={H - 8} fill="#666" fontSize="9" textAnchor="middle" fontFamily="monospace">{r.label}</text>
          ) : null;
        })}
      </svg>
      <div className="flex gap-4 mt-1 text-[10px]">
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-[#00CC66]" /><span className="text-[#888]">Revenue</span></span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-t border-dashed border-[#FF6633]" /><span className="text-[#888]">COGS + Opex</span></span>
      </div>
    </div>
  );
}

function PivotTable({ rows, groupBy }: { rows: PivotRow[]; groupBy: GroupMode }) {
  const heading = groupBy.charAt(0).toUpperCase() + groupBy.slice(1);
  if (rows.length === 0) {
    return <div className="border border-[#333] bg-[#1A1A1A] p-6 text-xs text-[#666] text-center">No journal lines for this period / filter</div>;
  }
  return (
    <div className="border border-[#333] bg-[#1A1A1A] rounded overflow-hidden">
      <div className="px-4 py-2 border-b border-[#333] text-[10px] uppercase tracking-widest font-bold text-[#FF6600]">
        Pivot · grouped by {heading}
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#333] bg-[#0F0F0F]">
            <th className="px-4 py-2 text-left text-[10px] uppercase tracking-wider text-[#888] font-normal">{heading}</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#00CC66] font-normal">Revenue</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#FF9900] font-normal">COGS</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#FF6600] font-normal">Gross</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#FF3333] font-normal">Opex</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#FF6600] font-normal">Net</th>
            <th className="px-4 py-2 text-right text-[10px] uppercase tracking-wider text-[#888] font-normal">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const gross = r.revenue - r.cogs;
            const net = gross - r.opex;
            return (
              <tr key={r.key} className="border-b border-[#222] last:border-b-0 hover:bg-[#222222]">
                <td className="px-4 py-2 text-[#E0E0E0]">
                  {r.drillHref ? <Link href={r.drillHref} className="hover:underline text-[#FF6600]">{r.label}</Link> : r.label}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-[#00CC66]">£{fmt(r.revenue)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[#FF9900]">£{fmt(r.cogs)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[#FF6600]">£{fmt(gross)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[#FF3333]">£{fmt(r.opex)}</td>
                <td className="px-4 py-2 text-right tabular-nums font-bold" style={{ color: net >= 0 ? "#00CC66" : "#FF3333" }}>£{fmt(net)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-[#888]">{pct(net, r.revenue)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, name, defaultValue, type = "text" }: { label: string; name: string; defaultValue: string; type?: string }) {
  return (
    <label className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">{label}</span>
      <input type={type} name={name} defaultValue={defaultValue}
        className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[140px]" />
    </label>
  );
}

function Select({ label, name, defaultValue, options }: { label: string; name: string; defaultValue: string; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">{label}</span>
      <select name={name} defaultValue={defaultValue}
        className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[160px]">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Section({ title, rows, accent, drillUrl }: { title: string; rows: { accountId: string; code: string; name: string; net: number }[]; accent: string; drillUrl: (id: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <div className="border border-[#333333] bg-[#1A1A1A]">
      <div className="px-4 py-2 border-b border-[#333333]">
        <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: accent }}>{title}</span>
      </div>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.accountId} className="border-b border-[#222222] last:border-b-0 hover:bg-[#222222]">
              <td className="px-4 py-2 text-xs text-[#FF6600] font-mono w-20">{r.code}</td>
              <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                <Link href={drillUrl(r.accountId)} className="hover:underline">{r.name}</Link>
              </td>
              <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0] w-32">£{fmt(r.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubTotal({ label, value, accent, emphasis }: { label: string; value: number; accent: string; emphasis?: boolean }) {
  return (
    <div className={`border ${emphasis ? "border-[#FF6600]" : "border-[#333333]"} bg-[#1A1A1A] flex justify-between items-baseline px-4 py-3`}>
      <span className={`${emphasis ? "text-sm" : "text-xs"} uppercase tracking-widest font-bold`} style={{ color: accent }}>{label}</span>
      <span className={`${emphasis ? "text-base" : "text-sm"} tabular-nums font-bold`} style={{ color: accent }}>£{fmt(value)}</span>
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

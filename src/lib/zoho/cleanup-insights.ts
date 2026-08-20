/**
 * Aggregations for the Zoho cleanup dashboard. Pure read functions —
 * never modify any data. Used by both the server-rendered page (initial
 * KPI tiles) and by the API route for live refresh.
 */
import { prisma } from "@/lib/prisma";

const STUCK_STATUSES = ["Draft", "Open", "Pending"];

const num = (v: unknown): number => (v == null ? 0 : Number(v));

export interface CleanupInsights {
  asOf: string;
  totalInvoices: number;
  outstanding: { count: number; balance: number };
  aging: Array<{ bucket: string; count: number; balance: number }>;
  statusByYear: Array<{ year: string; status: string; count: number }>;
  topDebtors: Array<{
    zohoCustomerId: string | null;
    customerName: string | null;
    count: number;
    balance: number;
    oldestDue: string | null;
    linkedCustomerId: string | null;
    linkedCustomerName: string | null;
  }>;
  staleDrafts: { count: number; faceValue: number };
  anomalies: {
    voidWithBalance: { count: number; balance: number };
    closedWithBalance: { count: number; balance: number };
    zeroTotal: number;
  };
  cashAccount: { count: number; balance: number };
  mappingCoverage: {
    distinctZohoCustomers: number;
    linkedZohoCustomers: number;
    distinctCfSites: number;
    linkedCfSites: number;
    invoicesNoCfSite: number;
  };
}

export async function getCleanupInsights(): Promise<CleanupInsights> {
  const today = new Date();

  // Pull headers once.
  const all = await prisma.zohoImportedInvoice.findMany({
    select: {
      zohoCustomerId: true,
      customerName: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      balance: true,
      status: true,
    },
  });

  const total = all.length;
  const outstanding = all.filter((i) => num(i.balance) > 0);
  const sumOut = outstanding.reduce((s, i) => s + num(i.balance), 0);

  // Aging buckets
  const ageBuckets: Record<string, [number, number]> = {
    "0-30": [0, 0],
    "31-60": [0, 0],
    "61-90": [0, 0],
    "91-180": [0, 0],
    "181-365": [0, 0],
    ">365": [0, 0],
    "no-due": [0, 0],
  };
  for (const i of outstanding) {
    if (!i.dueDate) {
      ageBuckets["no-due"][0]++;
      ageBuckets["no-due"][1] += num(i.balance);
      continue;
    }
    const days = Math.floor((today.getTime() - i.dueDate.getTime()) / 86400000);
    let b: keyof typeof ageBuckets;
    if (days <= 30) b = "0-30";
    else if (days <= 60) b = "31-60";
    else if (days <= 90) b = "61-90";
    else if (days <= 180) b = "91-180";
    else if (days <= 365) b = "181-365";
    else b = ">365";
    ageBuckets[b][0]++;
    ageBuckets[b][1] += num(i.balance);
  }
  const aging = Object.entries(ageBuckets).map(([bucket, [count, balance]]) => ({
    bucket,
    count,
    balance,
  }));

  // Status × year
  const byYearStatus = new Map<string, number>();
  for (const i of all) {
    const y = i.invoiceDate ? String(i.invoiceDate.getUTCFullYear()) : "no-date";
    const s = i.status || "—";
    const k = `${y}|${s}`;
    byYearStatus.set(k, (byYearStatus.get(k) || 0) + 1);
  }
  const statusByYear = [...byYearStatus.entries()].map(([k, count]) => {
    const [year, status] = k.split("|");
    return { year, status, count };
  });

  // Top debtors (by zohoCustomerId, includes link info if present)
  type Acc = { count: number; balance: number; oldestDue: Date | null; customerName: string | null };
  const byDebtor = new Map<string, Acc>();
  for (const i of outstanding) {
    const k = i.zohoCustomerId || `unk:${i.customerName}`;
    const e =
      byDebtor.get(k) || { count: 0, balance: 0, oldestDue: null, customerName: i.customerName };
    e.count++;
    e.balance += num(i.balance);
    if (i.dueDate && (!e.oldestDue || i.dueDate < e.oldestDue)) e.oldestDue = i.dueDate;
    byDebtor.set(k, e);
  }
  const topRaw = [...byDebtor.entries()]
    .sort((a, b) => b[1].balance - a[1].balance)
    .slice(0, 25);
  const topZohoIds = topRaw.map(([k]) => (k.startsWith("unk:") ? null : k)).filter(Boolean) as string[];
  const links = topZohoIds.length
    ? await prisma.zohoCustomerLink.findMany({
        where: { zohoCustomerId: { in: topZohoIds } },
        include: { customer: { select: { id: true, name: true } } },
      })
    : [];
  const linkMap = new Map(links.map((l) => [l.zohoCustomerId, l]));

  const topDebtors = topRaw.map(([k, e]) => {
    const zohoCustomerId = k.startsWith("unk:") ? null : k;
    const link = zohoCustomerId ? linkMap.get(zohoCustomerId) : null;
    return {
      zohoCustomerId,
      customerName: e.customerName,
      count: e.count,
      balance: e.balance,
      oldestDue: e.oldestDue ? e.oldestDue.toISOString().slice(0, 10) : null,
      linkedCustomerId: link?.customer.id ?? null,
      linkedCustomerName: link?.customer.name ?? null,
    };
  });

  // Stale drafts
  const stuck = all.filter(
    (i) =>
      STUCK_STATUSES.includes(i.status || "") &&
      i.invoiceDate &&
      today.getTime() - i.invoiceDate.getTime() > 90 * 86400000
  );
  const staleDrafts = {
    count: stuck.length,
    faceValue: stuck.reduce((s, i) => s + num(i.total), 0),
  };

  // Anomalies
  const voidWithBal = all.filter((i) => i.status === "Void" && num(i.balance) > 0);
  const closedWithBal = all.filter((i) => i.status === "Closed" && num(i.balance) > 0);
  const anomalies = {
    voidWithBalance: {
      count: voidWithBal.length,
      balance: voidWithBal.reduce((s, i) => s + num(i.balance), 0),
    },
    closedWithBalance: {
      count: closedWithBal.length,
      balance: closedWithBal.reduce((s, i) => s + num(i.balance), 0),
    },
    zeroTotal: all.filter((i) => i.total == null || num(i.total) === 0).length,
  };

  // Cash account pool
  const cashRows = all.filter((i) => /cash account|walk[- ]?in/i.test(i.customerName || ""));
  const cashAccount = {
    count: cashRows.length,
    balance: cashRows.reduce((s, i) => s + num(i.balance), 0),
  };

  // Mapping coverage
  const distinctZohoCustomerIds = new Set(all.map((i) => i.zohoCustomerId).filter(Boolean));
  const linkedZoho = await prisma.zohoCustomerLink.count();
  const linesAll = await prisma.zohoImportedInvoiceLine.findMany({
    select: { invoiceId: true, cfSite: true },
  });
  const cfSites = new Set(linesAll.map((l) => l.cfSite).filter(Boolean) as string[]);
  const invsNoSite = (() => {
    const sitesByInv = new Map<string, Set<string>>();
    for (const l of linesAll) {
      const set = sitesByInv.get(l.invoiceId) || new Set();
      if (l.cfSite) set.add(l.cfSite);
      sitesByInv.set(l.invoiceId, set);
    }
    let n = 0;
    for (const set of sitesByInv.values()) if (set.size === 0) n++;
    return n;
  })();
  const linkedSites = await prisma.zohoSiteLink.count();

  const mappingCoverage = {
    distinctZohoCustomers: distinctZohoCustomerIds.size,
    linkedZohoCustomers: linkedZoho,
    distinctCfSites: cfSites.size,
    linkedCfSites: linkedSites,
    invoicesNoCfSite: invsNoSite,
  };

  return {
    asOf: today.toISOString(),
    totalInvoices: total,
    outstanding: { count: outstanding.length, balance: sumOut },
    aging,
    statusByYear,
    topDebtors,
    staleDrafts,
    anomalies,
    cashAccount,
    mappingCoverage,
  };
}

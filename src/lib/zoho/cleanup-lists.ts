/**
 * Per-row lists for the cleanup workspace: distinct Zoho customers and
 * distinct cfSite text values, each enriched with stats + current link
 * status.
 */
import { prisma } from "@/lib/prisma";

const num = (v: unknown) => (v == null ? 0 : Number(v));

export interface ZohoCustomerRow {
  zohoCustomerId: string;
  zohoCustomerName: string | null;
  invoiceCount: number;
  totalRevenue: number;
  outstandingBalance: number;
  oldestDue: string | null;
  linkedCustomerId: string | null;
  linkedCustomerName: string | null;
}

export async function listZohoCustomers(): Promise<ZohoCustomerRow[]> {
  const all = await prisma.zohoImportedInvoice.findMany({
    where: { zohoCustomerId: { not: null } },
    select: {
      zohoCustomerId: true,
      customerName: true,
      total: true,
      balance: true,
      dueDate: true,
      status: true,
    },
  });

  type Acc = {
    name: string | null;
    count: number;
    revenue: number;
    balance: number;
    oldestDue: Date | null;
  };
  const map = new Map<string, Acc>();
  for (const i of all) {
    const k = i.zohoCustomerId!;
    const e = map.get(k) || { name: i.customerName, count: 0, revenue: 0, balance: 0, oldestDue: null };
    e.count++;
    if (i.status === "Closed") e.revenue += num(i.total);
    if (num(i.balance) > 0) {
      e.balance += num(i.balance);
      if (i.dueDate && (!e.oldestDue || i.dueDate < e.oldestDue)) e.oldestDue = i.dueDate;
    }
    if (!e.name && i.customerName) e.name = i.customerName;
    map.set(k, e);
  }

  const ids = [...map.keys()];
  const links = ids.length
    ? await prisma.zohoCustomerLink.findMany({
        where: { zohoCustomerId: { in: ids } },
        include: { customer: { select: { id: true, name: true } } },
      })
    : [];
  const linkMap = new Map(links.map((l) => [l.zohoCustomerId, l]));

  return [...map.entries()]
    .map(([zohoCustomerId, e]) => ({
      zohoCustomerId,
      zohoCustomerName: e.name,
      invoiceCount: e.count,
      totalRevenue: e.revenue,
      outstandingBalance: e.balance,
      oldestDue: e.oldestDue ? e.oldestDue.toISOString().slice(0, 10) : null,
      linkedCustomerId: linkMap.get(zohoCustomerId)?.customer.id ?? null,
      linkedCustomerName: linkMap.get(zohoCustomerId)?.customer.name ?? null,
    }))
    .sort((a, b) => b.outstandingBalance - a.outstandingBalance || b.invoiceCount - a.invoiceCount);
}

export interface ZohoSiteRow {
  cfSite: string;
  lineCount: number;
  invoiceCount: number;
  topCustomer: string | null;
  linkedSiteId: string | null;
  linkedSiteName: string | null;
}

export async function listZohoSites(): Promise<ZohoSiteRow[]> {
  const lines = await prisma.zohoImportedInvoiceLine.findMany({
    where: { cfSite: { not: null } },
    select: {
      cfSite: true,
      invoiceId: true,
      invoice: { select: { customerName: true } },
    },
  });

  type Acc = {
    lineCount: number;
    invoices: Set<string>;
    customerCounts: Map<string, number>;
  };
  const map = new Map<string, Acc>();
  for (const l of lines) {
    const k = l.cfSite!;
    const e = map.get(k) || { lineCount: 0, invoices: new Set(), customerCounts: new Map() };
    e.lineCount++;
    e.invoices.add(l.invoiceId);
    const cname = l.invoice.customerName || "—";
    e.customerCounts.set(cname, (e.customerCounts.get(cname) || 0) + 1);
    map.set(k, e);
  }

  const cfSites = [...map.keys()];
  const links = cfSites.length
    ? await prisma.zohoSiteLink.findMany({
        where: { cfSite: { in: cfSites } },
        include: { site: { select: { id: true, siteName: true } } },
      })
    : [];
  const linkMap = new Map(links.map((l) => [l.cfSite, l]));

  return [...map.entries()]
    .map(([cfSite, e]) => {
      let topCustomer: string | null = null;
      let topN = 0;
      for (const [c, n] of e.customerCounts) {
        if (n > topN) {
          topN = n;
          topCustomer = c;
        }
      }
      return {
        cfSite,
        lineCount: e.lineCount,
        invoiceCount: e.invoices.size,
        topCustomer,
        linkedSiteId: linkMap.get(cfSite)?.site.id ?? null,
        linkedSiteName: linkMap.get(cfSite)?.site.siteName ?? null,
      };
    })
    .sort((a, b) => b.lineCount - a.lineCount);
}

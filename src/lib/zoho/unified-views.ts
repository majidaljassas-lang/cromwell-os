/**
 * Read-only unified views: combine historical Zoho data with OS-native
 * data via the link tables. No data migration; pure query-time JOINs.
 *
 * Used by /customers/[id] and /sites/[id] to surface the "Historical
 * (Zoho)" tab.
 */
import { prisma } from "@/lib/prisma";

export interface ZohoInvoiceForCustomer {
  id: string;
  zohoCustomerId: string;
  zohoNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  total: number | null;
  balance: number | null;
  status: string | null;
  cleanupDecision: string | null;
  lineCount: number;
  /** Which OS Customer (this one or a subsidiary) the link is on. */
  attributedToCustomerId: string;
  attributedToCustomerName: string;
  /** True if this invoice has a per-invoice override (not coming via the Zoho-customer link). */
  isOverride: boolean;
}

/** Walk customer hierarchy down from root, returning every descendant + the root. */
async function collectHierarchy(
  rootId: string
): Promise<Array<{ id: string; name: string }>> {
  const acc: Array<{ id: string; name: string }> = [];
  const queue: string[] = [rootId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, name: true, subsidiaries: { select: { id: true } } },
    });
    if (!c) continue;
    acc.push({ id: c.id, name: c.name });
    for (const s of c.subsidiaries) queue.push(s.id);
  }
  return acc;
}

export async function getCustomerZohoInvoices(
  customerId: string
): Promise<ZohoInvoiceForCustomer[]> {
  // 1. Build the full hierarchy from this customer downwards (root + descendants).
  const hierarchy = await collectHierarchy(customerId);
  const customerIds = hierarchy.map((c) => c.id);
  const nameByCustomerId = new Map(hierarchy.map((c) => [c.id, c.name]));

  // 2. Zoho-customer-level links pointing into the hierarchy.
  const links = await prisma.zohoCustomerLink.findMany({
    where: { customerId: { in: customerIds } },
    select: { zohoCustomerId: true, customerId: true },
  });
  const customerByZohoId = new Map(links.map((l) => [l.zohoCustomerId, l.customerId]));
  const linkedZohoIds = links.map((l) => l.zohoCustomerId);

  // 3. Pull invoices in two ways:
  //    (a) any invoice whose overrideCustomerId is in the hierarchy
  //    (b) any invoice whose Zoho customer is linked to the hierarchy
  //        AND that does NOT have an override (so overrides aren't counted twice
  //        and overridden-out invoices don't appear here)
  const invs = await prisma.zohoImportedInvoice.findMany({
    where: {
      OR: [
        { overrideCustomerId: { in: customerIds } },
        {
          AND: [
            { overrideCustomerId: null },
            { zohoCustomerId: { in: linkedZohoIds.length > 0 ? linkedZohoIds : ["__none__"] } },
          ],
        },
      ],
    },
    orderBy: { invoiceDate: "desc" },
    select: {
      id: true,
      zohoCustomerId: true,
      zohoNumber: true,
      invoiceDate: true,
      dueDate: true,
      total: true,
      balance: true,
      status: true,
      cleanupDecision: true,
      overrideCustomerId: true,
      _count: { select: { lines: true } },
    },
  });

  // 4. Map each invoice to its attributed customer (override > zoho-link).
  return invs.map((i) => {
    const isOverride = i.overrideCustomerId != null;
    const attributedTo =
      i.overrideCustomerId ??
      customerByZohoId.get(i.zohoCustomerId!) ??
      customerId;
    return {
      id: i.id,
      zohoCustomerId: i.zohoCustomerId!,
      zohoNumber: i.zohoNumber,
      invoiceDate: i.invoiceDate?.toISOString().slice(0, 10) ?? null,
      dueDate: i.dueDate?.toISOString().slice(0, 10) ?? null,
      total: i.total != null ? Number(i.total) : null,
      balance: i.balance != null ? Number(i.balance) : null,
      status: i.status,
      cleanupDecision: i.cleanupDecision,
      lineCount: i._count.lines,
      attributedToCustomerId: attributedTo,
      attributedToCustomerName: nameByCustomerId.get(attributedTo) ?? "—",
      isOverride,
    };
  });
}

export interface ZohoLineForSite {
  invoiceId: string;
  zohoNumber: string | null;
  invoiceDate: string | null;
  customerName: string | null;
  lineNumber: number;
  itemDesc: string | null;
  itemName: string | null;
  quantity: number | null;
  itemTotal: number | null;
}

export async function getSiteZohoLines(siteId: string): Promise<{
  cfSites: string[];
  invoiceCount: number;
  lineCount: number;
  totalRevenue: number;
  outstanding: number;
  recentLines: ZohoLineForSite[];
}> {
  const links = await prisma.zohoSiteLink.findMany({
    where: { siteId },
    select: { cfSite: true },
  });
  const cfSites = links.map((l) => l.cfSite);
  if (cfSites.length === 0) {
    return { cfSites: [], invoiceCount: 0, lineCount: 0, totalRevenue: 0, outstanding: 0, recentLines: [] };
  }

  const lines = await prisma.zohoImportedInvoiceLine.findMany({
    where: { cfSite: { in: cfSites } },
    orderBy: [{ invoice: { invoiceDate: "desc" } }, { lineNumber: "asc" }],
    take: 200,
    select: {
      invoiceId: true,
      lineNumber: true,
      itemDesc: true,
      itemName: true,
      quantity: true,
      itemTotal: true,
      invoice: {
        select: { zohoNumber: true, invoiceDate: true, customerName: true },
      },
    },
  });

  // Aggregates over ALL lines for this site (not just the 200 most recent)
  const allLines = await prisma.zohoImportedInvoiceLine.findMany({
    where: { cfSite: { in: cfSites } },
    select: { invoiceId: true, itemTotal: true },
  });
  const invoiceIds = [...new Set(allLines.map((l) => l.invoiceId))];
  const invoices = invoiceIds.length
    ? await prisma.zohoImportedInvoice.findMany({
        where: { id: { in: invoiceIds } },
        select: { total: true, balance: true, status: true },
      })
    : [];
  const totalRevenue = invoices
    .filter((i) => i.status === "Closed")
    .reduce((s, i) => s + (i.total != null ? Number(i.total) : 0), 0);
  const outstanding = invoices.reduce(
    (s, i) => s + (i.balance != null && Number(i.balance) > 0 ? Number(i.balance) : 0),
    0
  );

  return {
    cfSites,
    invoiceCount: invoiceIds.length,
    lineCount: allLines.length,
    totalRevenue,
    outstanding,
    recentLines: lines.map((l) => ({
      invoiceId: l.invoiceId,
      zohoNumber: l.invoice.zohoNumber,
      invoiceDate: l.invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
      customerName: l.invoice.customerName,
      lineNumber: l.lineNumber,
      itemDesc: l.itemDesc,
      itemName: l.itemName,
      quantity: l.quantity != null ? Number(l.quantity) : null,
      itemTotal: l.itemTotal != null ? Number(l.itemTotal) : null,
    })),
  };
}

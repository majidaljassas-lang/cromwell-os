import { prisma } from "@/lib/prisma";

/**
 * Main view — one row per BILL LINE (unified: Zoho-imported staging + live OS).
 * Invoice-side columns populate when a match is persisted (matchedInvoiceLineId
 * on ZohoImportedBillLine, or BillLineAllocation chain on SupplierBillLine).
 *
 * Mirrors the columns of Majid's Excel "Main" sheet:
 *   Bill Date · Due Date · Vendor · Bill No · Bill Status · Account · Qty · Rate
 *   · Item Total · Description · Customer · CF.Site
 *   | Invoice No · Invoice Amount · Profit · Margin · Invoice Status
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CloseStatus = "CLOSED" | "LINKED_OPEN" | "UNLINKED";

type Row = {
  source: "ZOHO" | "OS";
  billLineId: string;
  billDate: string | null;
  dueDate: string | null;
  vendor: string | null;
  paymentTermsLabel: string | null;
  billNo: string | null;
  billStatus: string | null;
  account: string | null;
  qty: number;
  rate: number;
  itemTotal: number;
  description: string;
  // Effective site/customer at LINE level. When the bill line is matched to an
  // invoice line, we inherit the invoice's site/customer (line-level granularity
  // that Zoho doesn't support — Zoho only tags one site at bill-header level).
  // The originalSite/originalCustomer fields preserve the bill-side tag so the
  // UI can show "TBC → 83 Addison Road" promotions.
  customerName: string | null;
  cfSite: string | null;
  originalCfSite: string | null;
  originalCustomerName: string | null;
  siteInherited: boolean;
  customerInherited: boolean;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  profit: number | null;
  margin: number | null;
  invoiceStatus: string | null;
  closeStatus: CloseStatus;
  // Split summary — populated when bill line has manual line-item splits
  splitCount: number;
  splitSummary: string | null; // e.g. "1 → INV-004842 · 15 → INV-004843 · 4 → STOCK · 2 PENDING"
};

const SALES_CLOSED_STATUSES = new Set(["paid", "closed", "POSTED"].map(s => s.toLowerCase()));

// Site values that are not real attributions — when a bill line carries one of
// these AND the invoice match has a real site, the OS attributes the real site.
const PLACEHOLDER_SITES = new Set(
  ["", "tbc", "multi site", "multisite", "mutli site"].map(s => s.toLowerCase())
);
function isPlaceholderSite(s: string | null | undefined): boolean {
  if (!s) return true;
  return PLACEHOLDER_SITES.has(s.trim().toLowerCase());
}

function deriveCloseStatus(invoiceNumber: string | null, invoiceStatus: string | null): CloseStatus {
  if (!invoiceNumber) return "UNLINKED";
  if (invoiceStatus && SALES_CLOSED_STATUSES.has(invoiceStatus.toLowerCase())) return "CLOSED";
  return "LINKED_OPEN";
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
    const filter = url.searchParams.get("filter") || ""; // text filter
    const linkedOnly = url.searchParams.get("linkedOnly") === "1";
    const closeFilter = url.searchParams.get("close") as CloseStatus | "ALL" | null;

    // Pull Zoho-imported bill lines with their bills, ordered by date desc
    const zohoLines = await prisma.zohoImportedBillLine.findMany({
      take: limit,
      skip: offset,
      orderBy: { bill: { billDate: "desc" } },
      include: { bill: true },
    });

    // Resolve matched invoice lines in one query
    const matchedIds = zohoLines
      .map((l) => l.matchedInvoiceLineId)
      .filter((id): id is string => !!id);
    const matchedInvLines = matchedIds.length
      ? await prisma.zohoImportedInvoiceLine.findMany({
          where: { id: { in: matchedIds } },
          include: { invoice: true },
        })
      : [];
    const invMap = new Map(matchedInvLines.map((il) => [il.id, il]));

    // Pull split allocations for the bill lines on this page (junction table)
    const billLineIds = zohoLines.map((l) => l.id);
    const splits = billLineIds.length
      ? await prisma.zohoBillLineMatch.findMany({
          where: { billLineId: { in: billLineIds } },
        })
      : [];
    const splitsByBill = new Map<string, typeof splits>();
    for (const s of splits) {
      if (!splitsByBill.has(s.billLineId)) splitsByBill.set(s.billLineId, []);
      splitsByBill.get(s.billLineId)!.push(s);
    }
    // For INVOICE-typed splits, resolve invoice numbers for the summary text
    const splitInvoiceLineIds = splits
      .map((s) => s.invoiceLineId)
      .filter((x): x is string => !!x);
    const splitInvLines = splitInvoiceLineIds.length
      ? await prisma.zohoImportedInvoiceLine.findMany({
          where: { id: { in: splitInvoiceLineIds } },
          include: { invoice: { select: { zohoNumber: true } } },
        })
      : [];
    const splitInvLineMap = new Map(splitInvLines.map((il) => [il.id, il]));

    const rows: Row[] = [];

    for (const l of zohoLines) {
      const inv = l.matchedInvoiceLineId ? invMap.get(l.matchedInvoiceLineId) : null;
      const cost = Number(l.itemTotal ?? 0);
      const invAmt = inv ? Number(inv.itemTotal ?? 0) : null;
      const profit = invAmt != null ? invAmt - cost : null;
      const margin = invAmt && invAmt > 0 ? (profit ?? 0) / invAmt : null;
      const payload = (l.bill.payload || {}) as Record<string, unknown>;

      const invoiceNumber = inv?.invoice?.zohoNumber ?? null;
      const invoiceStatus = inv?.invoice?.status ?? null;

      // Line-level site attribution. If the bill carries a placeholder ("TBC",
      // "Multi Site", empty) and the matched invoice line has a real site,
      // attribute the real site to this line. This is the gap Zoho can't close —
      // Zoho only tags one site at the bill header.
      const billSite = l.cfSite;
      const invoiceSite = inv?.cfSite ?? null;
      let effectiveSite = billSite;
      let siteInherited = false;
      if (isPlaceholderSite(billSite) && !isPlaceholderSite(invoiceSite)) {
        effectiveSite = invoiceSite;
        siteInherited = true;
      }

      // Same logic for customer — bill line might lack one, invoice header has
      // it (the customer the bill was billed out TO).
      const billCust = l.customerName;
      const invoiceCust = inv?.invoice?.customerName ?? null;
      let effectiveCustomer = billCust;
      let customerInherited = false;
      if ((!billCust || !billCust.trim()) && invoiceCust && invoiceCust.trim()) {
        effectiveCustomer = invoiceCust;
        customerInherited = true;
      }

      // Build split summary string — human-readable so the row hints at allocations
      const lineSplits = splitsByBill.get(l.id) ?? [];
      const splitSummary = lineSplits.length === 0 ? null : lineSplits.map((s) => {
        const q = Number(s.qtyAllocated);
        if (s.targetType === "INVOICE" && s.invoiceLineId) {
          const il = splitInvLineMap.get(s.invoiceLineId);
          return `${q} → ${il?.invoice?.zohoNumber ?? "?"}`;
        }
        if (s.targetType === "STOCK") return `${q} → STOCK${s.targetSiteName ? ` (${s.targetSiteName})` : ""}`;
        if (s.targetType === "WRITE_OFF") return `${q} → WRITE_OFF`;
        if (s.targetType === "TICKET") return `${q} → ${s.targetTicketRef ?? "TICKET"}`;
        if (s.targetType === "PENDING") return `${q} → PENDING${s.targetCustomerName ? ` (${s.targetCustomerName})` : ""}`;
        return `${q} → ${s.targetType}`;
      }).join(" · ");

      rows.push({
        source: "ZOHO",
        billLineId: l.id,
        billDate: l.bill.billDate?.toISOString() ?? null,
        dueDate: l.bill.dueDate?.toISOString() ?? null,
        vendor: l.bill.vendorName,
        paymentTermsLabel: typeof payload["Payment Terms Label"] === "string" ? payload["Payment Terms Label"] as string : null,
        billNo: l.bill.zohoNumber,
        billStatus: l.bill.status,
        account: l.account,
        qty: Number(l.quantity ?? 0),
        rate: Number(l.rate ?? 0),
        itemTotal: cost,
        description: l.itemDesc || l.itemName || "",
        customerName: effectiveCustomer,
        cfSite: effectiveSite,
        originalCfSite: billSite,
        originalCustomerName: billCust,
        siteInherited,
        customerInherited,
        invoiceNumber,
        invoiceAmount: invAmt,
        profit,
        margin,
        invoiceStatus,
        closeStatus: deriveCloseStatus(invoiceNumber, invoiceStatus),
        splitCount: lineSplits.length,
        splitSummary,
      });
    }

    // Pull live OS SupplierBillLines (small set today — Boyden only)
    // Linkage to invoice goes via BillLineAllocation → TicketLine → SalesInvoiceLine.
    // For v1 we surface OS bill lines with their allocation but invoice columns blank
    // until SalesInvoiceLine wiring is added.
    // OS rows pull the full chain: BillLineAllocation → TicketLine → SalesInvoiceLine → SalesInvoice
    // so a live-OS bill line resolves the same way a Zoho bill line does:
    // closed if invoice paid, linked-open if invoice exists unpaid, unlinked otherwise.
    const osLines = await prisma.supplierBillLine.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: {
        supplierBill: { include: { supplier: true } },
        billLineAllocations: {
          take: 1,
          include: {
            site: true,
            customer: true,
            ticketLine: {
              include: {
                invoiceLines: {
                  take: 1,
                  orderBy: { createdAt: "desc" },
                  include: {
                    salesInvoice: {
                      include: { customer: true, site: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    for (const l of osLines) {
      const cost = Number(l.lineTotal ?? 0);
      const alloc = l.billLineAllocations[0];
      // Resolve OS-side invoice match through allocation → ticket line → sales invoice line
      const salesLine = alloc?.ticketLine?.invoiceLines?.[0] ?? null;
      const salesInv = salesLine?.salesInvoice ?? null;
      const invoiceNumber = salesInv?.invoiceNo ?? null;
      const invoiceAmount = salesLine ? Number(salesLine.lineTotal ?? 0) : null;
      const invoiceStatus = salesInv?.status ?? null;
      const osProfit = invoiceAmount != null ? invoiceAmount - cost : null;
      const osMargin = invoiceAmount && invoiceAmount > 0 ? (osProfit ?? 0) / invoiceAmount : null;

      // Site/customer attribution: prefer the sales invoice (most authoritative
      // — that's where it actually got billed), fall back to allocation, then
      // bill header. Each falls through to the next when blank.
      const invSite  = salesInv?.site?.siteName ?? null;
      const invCust  = salesInv?.customer?.name ?? null;
      const allocSite = alloc?.site?.siteName ?? null;
      const allocCust = alloc?.customer?.name ?? null;
      const billSite = l.supplierBill.siteRef;
      const effectiveSite     = invSite ?? allocSite ?? billSite ?? null;
      const effectiveCustomer = invCust ?? allocCust ?? null;
      const siteInherited     = !!(invSite || allocSite) && (invSite || allocSite) !== billSite;
      const customerInherited = !!effectiveCustomer;

      // OS close status: same rule as Zoho. invoice paid/closed → CLOSED,
      // invoice exists unpaid → LINKED_OPEN, no invoice → UNLINKED.
      const isPaid = !!salesInv?.paidAt
        || (invoiceStatus ? SALES_CLOSED_STATUSES.has(invoiceStatus.toLowerCase()) : false);
      const closeStatus: CloseStatus =
        !invoiceNumber ? "UNLINKED" : isPaid ? "CLOSED" : "LINKED_OPEN";

      rows.push({
        source: "OS",
        billLineId: l.id,
        billDate: l.supplierBill.billDate?.toISOString() ?? null,
        dueDate: l.supplierBill.dueDate?.toISOString() ?? null,
        vendor: l.supplierBill.supplier?.name ?? null,
        paymentTermsLabel: null,
        billNo: l.supplierBill.billNo,
        billStatus: l.supplierBill.status,
        account: "Materials",
        qty: Number(l.qty ?? 0),
        rate: Number(l.unitCost ?? 0),
        itemTotal: cost,
        description: l.description || "",
        customerName: effectiveCustomer,
        cfSite: effectiveSite,
        originalCfSite: billSite,
        originalCustomerName: null, // SupplierBill has no header customer-name string
        siteInherited,
        customerInherited,
        invoiceNumber,
        invoiceAmount,
        profit: osProfit,
        margin: osMargin,
        invoiceStatus,
        closeStatus,
        splitCount: 0,
        splitSummary: null,
      });
    }

    // Apply filters
    let filtered = rows;
    if (filter) {
      const f = filter.toLowerCase();
      filtered = filtered.filter((r) =>
        (r.vendor || "").toLowerCase().includes(f) ||
        (r.billNo || "").toLowerCase().includes(f) ||
        (r.description || "").toLowerCase().includes(f) ||
        (r.customerName || "").toLowerCase().includes(f) ||
        (r.cfSite || "").toLowerCase().includes(f) ||
        (r.invoiceNumber || "").toLowerCase().includes(f)
      );
    }
    if (linkedOnly) {
      filtered = filtered.filter((r) => r.invoiceNumber);
    }
    if (closeFilter && closeFilter !== "ALL") {
      filtered = filtered.filter((r) => r.closeStatus === closeFilter);
    }

    // Aggregate totals across the (possibly filtered) result, split by close status
    const totals = filtered.reduce(
      (a, r) => {
        a.cost += r.itemTotal;
        a.revenue += r.invoiceAmount || 0;
        if (r.closeStatus === "CLOSED")        { a.closed++;     a.closedCost += r.itemTotal; }
        else if (r.closeStatus === "LINKED_OPEN") { a.linkedOpen++; a.linkedOpenCost += r.itemTotal; }
        else                                    { a.unlinked++;   a.unlinkedCost += r.itemTotal; }
        if (r.invoiceAmount) {
          a.linkedRevenue += r.invoiceAmount;
          a.linkedCost += r.itemTotal;
        }
        return a;
      },
      {
        cost: 0, revenue: 0,
        closed: 0, closedCost: 0,
        linkedOpen: 0, linkedOpenCost: 0,
        unlinked: 0, unlinkedCost: 0,
        linkedRevenue: 0, linkedCost: 0,
      }
    );
    const totalProfit = totals.linkedRevenue - totals.linkedCost;
    const blendedMargin = totals.linkedRevenue > 0 ? totalProfit / totals.linkedRevenue : null;

    const totalCount = await prisma.zohoImportedBillLine.count();

    return Response.json({
      rows: filtered,
      totalCount,
      shown: filtered.length,
      limit, offset,
      totals: {
        cost: totals.cost,
        revenue: totals.revenue,
        profit: totalProfit,
        margin: blendedMargin,
        // Recovery breakdown — the three terminal states per bill line
        closed:      { count: totals.closed,     cost: totals.closedCost },
        linkedOpen:  { count: totals.linkedOpen, cost: totals.linkedOpenCost },
        unlinked:    { count: totals.unlinked,   cost: totals.unlinkedCost },
      },
    });
  } catch (e) {
    console.error("[main] failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "main view failed" },
      { status: 500 }
    );
  }
}

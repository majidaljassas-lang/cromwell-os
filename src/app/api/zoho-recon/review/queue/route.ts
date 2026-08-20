import { prisma } from "@/lib/prisma";

/**
 * Review queue — auto-proposed bill↔invoice matches awaiting human confirmation.
 * Selects bill lines whose matchReason starts with "T1" or "T2" (auto-close output).
 *
 * Returns full both-sides context per pair so the UI can render approve/reject
 * decisions with all the data the user needs in one place.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const tier = url.searchParams.get("tier"); // "T1" | "T2" | null

  const where: Record<string, unknown> = {
    matchedInvoiceLineId: { not: null },
    matchReason: tier === "T1" ? { startsWith: "T1" }
              : tier === "T2" ? { startsWith: "T2" }
              : { OR: undefined }, // handled below
  };
  if (!tier) {
    where.matchReason = { OR: [{ startsWith: "T1" }, { startsWith: "T2" }] };
    // Prisma can't OR within a string filter directly without raw — use raw OR on the line.
    delete (where as Record<string, unknown>).matchReason;
    where.OR = [{ matchReason: { startsWith: "T1" } }, { matchReason: { startsWith: "T2" } }];
  }

  const [count, billLines] = await Promise.all([
    prisma.zohoImportedBillLine.count({ where }),
    prisma.zohoImportedBillLine.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ bill: { billDate: "desc" } }],
      include: { bill: { select: { billDate: true, vendorName: true, zohoNumber: true, status: true } } },
    }),
  ]);

  const invIds = billLines.map((b) => b.matchedInvoiceLineId).filter((x): x is string => !!x);
  const invLines = invIds.length
    ? await prisma.zohoImportedInvoiceLine.findMany({
        where: { id: { in: invIds } },
        include: { invoice: { select: { zohoNumber: true, customerName: true, invoiceDate: true, status: true } } },
      })
    : [];
  const invMap = new Map(invLines.map((il) => [il.id, il]));

  const pairs = billLines.map((bl) => {
    const il = bl.matchedInvoiceLineId ? invMap.get(bl.matchedInvoiceLineId) : null;
    const cost = Number(bl.itemTotal ?? 0);
    const revenue = il ? Number(il.itemTotal ?? 0) : 0;
    const profit = il ? revenue - cost : null;
    const margin = revenue > 0 && profit != null ? profit / revenue : null;
    return {
      billLineId: bl.id,
      bill: {
        date: bl.bill.billDate?.toISOString() ?? null,
        vendor: bl.bill.vendorName,
        billNo: bl.bill.zohoNumber,
        status: bl.bill.status,
        qty: Number(bl.quantity ?? 0),
        rate: Number(bl.rate ?? 0),
        cost,
        description: bl.itemDesc || bl.itemName || "",
        cfSite: bl.cfSite,
        customerName: bl.customerName,
      },
      invoice: il ? {
        invoiceNumber: il.invoice?.zohoNumber ?? null,
        invoiceDate: il.invoice?.invoiceDate?.toISOString() ?? null,
        invoiceStatus: il.invoice?.status ?? null,
        customer: il.invoice?.customerName ?? null,
        cfSite: il.cfSite,
        qty: Number(il.quantity ?? 0),
        rate: Number(il.itemPrice ?? 0),
        revenue,
        description: il.itemDesc || il.itemName || "",
      } : null,
      profit,
      margin,
      tier: bl.matchReason?.startsWith("T1") ? "T1" : bl.matchReason?.startsWith("T2") ? "T2" : "?",
      reason: bl.matchReason,
      confidence: bl.matchConfidence != null ? Number(bl.matchConfidence) : null,
    };
  });

  return Response.json({ pairs, count, limit, offset });
}

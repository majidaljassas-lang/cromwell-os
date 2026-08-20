import { prisma } from "@/lib/prisma";

/**
 * Paginated list of imported Zoho invoices for the bills-vs-invoices recovery UI.
 * Counts cleared/uncleared invoice lines via the matchedInvoiceLineId set on
 * the bill line side (already persisted by the manual matcher path).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

  const invoices = await prisma.zohoImportedInvoice.findMany({
    orderBy: { invoiceDate: "desc" },
    take: limit,
    skip: offset,
    select: {
      id: true,
      zohoNumber: true,
      customerName: true,
      invoiceDate: true,
      total: true,
      balance: true,
      status: true,
      lines: { select: { id: true, itemTotal: true } },
    },
  });

  const invoiceLineIds = invoices.flatMap((i) => i.lines.map((l) => l.id));
  const matched = invoiceLineIds.length === 0
    ? new Map<string, true>()
    : new Map(
        (await prisma.zohoImportedBillLine.findMany({
          where: { matchedInvoiceLineId: { in: invoiceLineIds } },
          select: { matchedInvoiceLineId: true },
        })).map((b) => [b.matchedInvoiceLineId!, true as const])
      );

  const rows = invoices.map((i) => {
    let cleared = 0, unmatched = 0, clearedValue = 0, unmatchedValue = 0;
    for (const l of i.lines) {
      const value = Number(l.itemTotal ?? 0);
      if (matched.has(l.id)) { cleared++; clearedValue += value; }
      else { unmatched++; unmatchedValue += value; }
    }
    return {
      id: i.id,
      zohoNumber: i.zohoNumber,
      customerName: i.customerName,
      invoiceDate: i.invoiceDate,
      total: Number(i.total ?? 0),
      balance: Number(i.balance ?? 0),
      status: i.status,
      lineCount: i.lines.length,
      cleared,
      unmatched,
      clearedValue,
      unmatchedValue,
    };
  });

  const totalCount = await prisma.zohoImportedInvoice.count();
  return Response.json({ rows, totalCount, limit, offset });
  } catch (e) {
    console.error("[zoho-recon/invoices] failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "list failed", stack: e instanceof Error ? e.stack : undefined },
      { status: 500 }
    );
  }
}

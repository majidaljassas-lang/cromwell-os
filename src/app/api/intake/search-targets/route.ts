/**
 * GET /api/intake/search-targets?q=...&billLineId=...
 *
 * Manual link search — finds candidate TicketLines / CustomerPOLines / SalesInvoiceLines
 * matching the query. Used by the bill-line cell when the auto-suggestions are wrong
 * and the user wants to pick a different destination by hand.
 */
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ candidates: [] });

  // If the query looks like a ticket number "#39" or "39", boost ticket lines on that ticket
  const ticketNoMatch = q.match(/^#?(\d+)$/);
  const ticketNo = ticketNoMatch ? Number(ticketNoMatch[1]) : null;

  const tlWhere: Record<string, unknown> = {
    OR: [
      { description: { contains: q, mode: "insensitive" } },
      ...(ticketNo ? [{ ticket: { ticketNo } }] : []),
    ],
  };

  const [ticketLines, poLines, invLines] = await Promise.all([
    prisma.ticketLine.findMany({
      where: tlWhere,
      select: {
        id: true, description: true, qty: true, unit: true,
        ticketId: true, siteId: true, payingCustomerId: true,
        ticket: { select: { id: true, ticketNo: true, title: true, payingCustomerId: true, siteId: true, payingCustomer: { select: { name: true } }, site: { select: { siteName: true } } } },
      },
      take: 25,
      orderBy: { createdAt: "desc" },
    }),
    prisma.customerPOLine.findMany({
      where: { description: { contains: q, mode: "insensitive" } },
      select: {
        id: true, description: true, qty: true,
        customerPO: { select: { id: true, poNo: true, ticketId: true, siteId: true, customerId: true, customer: { select: { name: true } } } },
      },
      take: 15,
      orderBy: { createdAt: "desc" },
    }),
    prisma.salesInvoiceLine.findMany({
      where: { description: { contains: q, mode: "insensitive" } },
      select: {
        id: true, description: true, qty: true, unitPrice: true, lineTotal: true, ticketLineId: true,
        salesInvoice: { select: { id: true, invoiceNo: true, status: true, ticketId: true, siteId: true, customerId: true, customer: { select: { name: true } } } },
      },
      take: 15,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const candidates = [
    ...ticketLines.map((tl) => ({
      source: "TICKET_LINE" as const,
      recordId: tl.id,
      ticketId: tl.ticketId,
      siteId: tl.siteId ?? tl.ticket?.siteId ?? null,
      customerId: tl.payingCustomerId ?? tl.ticket?.payingCustomerId ?? null,
      description: tl.description,
      label: `#${tl.ticket?.ticketNo} ${tl.ticket?.title ?? ""}`,
      customer: tl.ticket?.payingCustomer?.name ?? null,
      site: tl.ticket?.site?.siteName ?? null,
      qty: Number(tl.qty),
      unit: tl.unit,
    })),
    ...poLines.map((pl) => ({
      source: "PO_LINE" as const,
      recordId: pl.id,
      ticketId: pl.customerPO?.ticketId ?? null,
      siteId: pl.customerPO?.siteId ?? null,
      customerId: pl.customerPO?.customerId ?? null,
      description: pl.description,
      label: `PO ${pl.customerPO?.poNo}`,
      customer: pl.customerPO?.customer?.name ?? null,
      site: null,
      qty: Number(pl.qty),
      unit: null,
    })),
    ...invLines.map((il) => ({
      source: "INVOICE_LINE" as const,
      recordId: il.id,
      ticketId: il.salesInvoice?.ticketId ?? null,
      siteId: il.salesInvoice?.siteId ?? null,
      customerId: il.salesInvoice?.customerId ?? null,
      description: il.description,
      label: `Inv ${il.salesInvoice?.invoiceNo} (${il.salesInvoice?.status})`,
      customer: il.salesInvoice?.customer?.name ?? null,
      site: null,
      qty: Number(il.qty),
      unit: null,
    })),
  ];

  return Response.json({ candidates });
}

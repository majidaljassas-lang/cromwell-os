/**
 * POST /api/quotes/[id]/convert-to-invoice
 *
 * Converts an APPROVED quote into a SalesInvoice. Each QuoteLine becomes
 * a SalesInvoiceLine 1:1, preserving the approved unit prices. The invoice
 * is created in DRAFT status — call /sales-invoices/[id]/send to issue and
 * post the AR journal entry.
 *
 * Optional body:
 *   { issueImmediately?: boolean }   — if true, issue + post JE in same tx
 */
import { prisma } from "@/lib/prisma";
import { postSalesInvoice } from "@/lib/finance/gl-posting";
import { STANDARD_VAT_RATE, lineVat } from "@/lib/finance/invoice-totals";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({})) as { issueImmediately?: boolean };

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        customer: { select: { outsideUkVatScope: true } },
        ticket: { select: { id: true, siteId: true, siteCommercialLinkId: true, payingCustomerId: true } },
      },
    });
    if (!quote) return Response.json({ error: "Quote not found" }, { status: 404 });
    if (quote.status !== "APPROVED")
      return Response.json(
        { error: `Quote must be APPROVED to convert (currently ${quote.status})` },
        { status: 400 }
      );
    if (quote.lines.length === 0)
      return Response.json({ error: "Quote has no lines" }, { status: 400 });

    const siteId = quote.siteId ?? quote.ticket.siteId;
    if (!siteId)
      return Response.json({ error: "Quote has no site" }, { status: 422 });

    const linkedPO = await prisma.customerPO.findFirst({
      where: { ticketId: quote.ticketId, quoteId: quote.id },
      orderBy: { createdAt: "desc" },
      select: { poNo: true },
    });

    const vatRate = quote.customer.outsideUkVatScope ? 0 : STANDARD_VAT_RATE;
    const subtotal = r2(quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0));
    const vat = r2(subtotal * (vatRate / 100));
    const total = r2(subtotal + vat);

    const issuedAt = body.issueImmediately ? new Date() : null;
    const dueDate = issuedAt
      ? new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000)
      : null;
    const invoiceNo = `INV-${Date.now()}`;

    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.create({
        data: {
          ticketId: quote.ticketId,
          invoiceNo,
          customerId: quote.customerId,
          siteId,
          siteCommercialLinkId: quote.siteCommercialLinkId ?? quote.ticket.siteCommercialLinkId,
          poNo: linkedPO?.poNo ?? null,
          invoiceType: quote.quoteType ?? "STANDARD",
          status: body.issueImmediately ? "SENT" : "DRAFT",
          issuedAt,
          dueDate,
          totalSell: total,
          totalNet: subtotal,
          totalVat: vat,
          totalGross: total,
          notes: `Converted from quote ${quote.quoteNo} v${quote.versionNo}`,
        },
      });

      await tx.salesInvoiceLine.createMany({
        data: quote.lines.map((l, i) => {
          const lineNet = Number(l.lineTotal);
          return {
            salesInvoiceId: inv.id,
            ticketLineId: l.ticketLineId,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            vatRate,
            vatAmount: lineVat(lineNet, vatRate),
            displayMode: "LINE",
            displayOrder: i + 1,
          };
        }),
      });

      // Post AR journal entry on issue
      if (body.issueImmediately) {
        await postSalesInvoice(inv.id, tx);
        await tx.ticket.update({
          where: { id: quote.ticketId },
          data: {
            status: "INVOICED",
            invoicedAt: issuedAt!,
            lastActivityAt: issuedAt!,
          },
        });
      }

      await tx.event.create({
        data: {
          ticketId: quote.ticketId,
          eventType: body.issueImmediately ? "INVOICE_RAISED" : "INVOICE_DRAFTED",
          timestamp: new Date(),
          notes: `${body.issueImmediately ? "Invoice issued" : "Invoice drafted"} from quote ${quote.quoteNo} — ${invoiceNo} · £${total.toFixed(2)}`,
        },
      });

      return inv;
    });

    return Response.json({ ok: true, invoiceId: result.id, invoiceNo, subtotal, vat, total });
  } catch (e) {
    console.error("/api/quotes/[id]/convert-to-invoice POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Conversion failed" },
      { status: 500 }
    );
  }
}

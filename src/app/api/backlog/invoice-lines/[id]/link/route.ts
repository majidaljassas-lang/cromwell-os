import { prisma } from "@/lib/prisma";

/**
 * POST /api/backlog/invoice-lines/[id]/link
 * Body: { ticketLineId: string }
 *
 * Manually links an invoice line to a ticket line.
 *  - creates a BacklogInvoiceMatch
 *  - sets the ticket line's status to INVOICED
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: invoiceLineId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const ticketLineId: string | undefined = body?.ticketLineId;
    if (!ticketLineId) {
      return Response.json({ error: "ticketLineId is required" }, { status: 400 });
    }

    const invoiceLine = await prisma.backlogInvoiceLine.findUnique({
      where: { id: invoiceLineId },
    });
    if (!invoiceLine) return Response.json({ error: "Invoice line not found" }, { status: 404 });

    const ticketLine = await prisma.backlogTicketLine.findUnique({
      where: { id: ticketLineId },
    });
    if (!ticketLine) return Response.json({ error: "Ticket line not found" }, { status: 404 });

    const existing = await prisma.backlogInvoiceMatch.findFirst({
      where: { ticketLineId, invoiceLineId },
    });

    const match = existing ?? await prisma.backlogInvoiceMatch.create({
      data: {
        ticketLineId,
        invoiceLineId,
        matchConfidence: 100,
        matchMethod: "MANUAL_LINK",
      },
    });

    const updated = await prisma.backlogTicketLine.update({
      where: { id: ticketLineId },
      data: { status: "INVOICED" },
    });

    // Mark the invoice line so it leaves the "pending review" pile
    await prisma.backlogInvoiceLine.update({
      where: { id: invoiceLineId },
      data: {
        classification: "MANUAL_LINKED",
        classificationNote: `Linked to ticket line ${ticketLineId}`,
        classifiedAt: new Date(),
      },
    });

    return Response.json({ ok: true, match, ticketLine: updated });
  } catch (err) {
    console.error("link-invoice-line failed:", err);
    return Response.json({ error: "Failed to link invoice line" }, { status: 500 });
  }
}

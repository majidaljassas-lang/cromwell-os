import { prisma } from "@/lib/prisma";

/**
 * POST /api/backlog/invoice-lines/[id]/create-thread
 * Body: { threadLabel: string, threadDescription?: string }
 *
 * Off-Chat triage action: invoice line deserves its own thread.
 *  - Creates a new BacklogOrderThread on the same case
 *  - Creates a single BacklogTicketLine on that thread mirroring the invoice
 *    line (same product, qty, unit, date)
 *  - Wires a BacklogInvoiceMatch (MANUAL_NEW_THREAD)
 *  - Sets the ticket line status = INVOICED
 *  - Sets BacklogInvoiceLine.classification = MANUAL_LINKED
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: invoiceLineId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const threadLabel: string | undefined = body?.threadLabel;
    const threadDescription: string | undefined = body?.threadDescription;

    if (!threadLabel || !threadLabel.trim()) {
      return Response.json({ error: "threadLabel is required" }, { status: 400 });
    }

    const invoiceLine = await prisma.backlogInvoiceLine.findUnique({
      where: { id: invoiceLineId },
    });
    if (!invoiceLine) return Response.json({ error: "Invoice line not found" }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      const thread = await tx.backlogOrderThread.create({
        data: {
          caseId: invoiceLine.caseId,
          label: threadLabel.trim(),
          description: threadDescription?.trim() || null,
          messageIds: [],
        },
      });

      const ticketLine = await tx.backlogTicketLine.create({
        data: {
          caseId: invoiceLine.caseId,
          orderThreadId: thread.id,
          sourceMessageId: null,
          date: invoiceLine.invoiceDate,
          sender: invoiceLine.customer || "off-chat",
          rawText: invoiceLine.productDescription,
          normalizedProduct: invoiceLine.normalizedProduct,
          requestedQty: invoiceLine.qty,
          requestedUnit: invoiceLine.unit,
          requestedQtyBase: invoiceLine.qtyBase,
          baseUnit: invoiceLine.baseUnit,
          notes: `Created from off-chat invoice line ${invoiceLine.invoiceNumber}`,
          status: "INVOICED",
        },
      });

      const match = await tx.backlogInvoiceMatch.create({
        data: {
          ticketLineId: ticketLine.id,
          invoiceLineId: invoiceLine.id,
          matchConfidence: 100,
          matchMethod: "MANUAL_NEW_THREAD",
        },
      });

      const updatedInvoiceLine = await tx.backlogInvoiceLine.update({
        where: { id: invoiceLine.id },
        data: {
          classification: "MANUAL_LINKED",
          classificationNote: `New thread: ${thread.label}`,
          classifiedAt: new Date(),
        },
      });

      return { thread, ticketLine, match, invoiceLine: updatedInvoiceLine };
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("create-thread-from-invoice-line failed:", err);
    return Response.json({ error: "Failed to create thread" }, { status: 500 });
  }
}

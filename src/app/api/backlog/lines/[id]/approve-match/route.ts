import { prisma } from "@/lib/prisma";

/**
 * POST /api/backlog/lines/[id]/approve-match
 * Body: { invoiceLineId: string }
 *
 * Approves a suggested match:
 *  - creates a BacklogInvoiceMatch between the ticket line and invoice line
 *  - sets the ticket line's status to INVOICED
 *  - removes the "Possible match: INV-..." text from the ticket line's notes
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketLineId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const invoiceLineId: string | undefined = body?.invoiceLineId;
    if (!invoiceLineId) {
      return Response.json({ error: "invoiceLineId is required" }, { status: 400 });
    }

    const ticketLine = await prisma.backlogTicketLine.findUnique({
      where: { id: ticketLineId },
    });
    if (!ticketLine) return Response.json({ error: "Ticket line not found" }, { status: 404 });

    const invoiceLine = await prisma.backlogInvoiceLine.findUnique({
      where: { id: invoiceLineId },
    });
    if (!invoiceLine) return Response.json({ error: "Invoice line not found" }, { status: 404 });

    // Strip any "Possible match: ..." suggestion off the notes (leave other notes alone)
    const cleanedNotes = (ticketLine.notes || "")
      .replace(/Possible match:[^\n]*/gi, "")
      .replace(/\n{2,}/g, "\n")
      .trim() || null;

    // Check if the match already exists (idempotent)
    const existing = await prisma.backlogInvoiceMatch.findFirst({
      where: { ticketLineId, invoiceLineId },
    });

    const match = existing ?? await prisma.backlogInvoiceMatch.create({
      data: {
        ticketLineId,
        invoiceLineId,
        matchConfidence: 100,
        matchMethod: "MANUAL_APPROVE",
      },
    });

    const updated = await prisma.backlogTicketLine.update({
      where: { id: ticketLineId },
      data: { status: "INVOICED", notes: cleanedNotes },
    });

    return Response.json({ ok: true, match, ticketLine: updated });
  } catch (err) {
    console.error("approve-match failed:", err);
    return Response.json({ error: "Failed to approve match" }, { status: 500 });
  }
}

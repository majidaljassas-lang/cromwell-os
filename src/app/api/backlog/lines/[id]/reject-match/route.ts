import { prisma } from "@/lib/prisma";

/**
 * POST /api/backlog/lines/[id]/reject-match
 *
 * Rejects a suggested match. Does NOT create a BacklogInvoiceMatch.
 * Simply strips the "Possible match: INV-..." text off the ticket line's notes
 * so it no longer appears in the review queue.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketLineId } = await params;
  try {
    const ticketLine = await prisma.backlogTicketLine.findUnique({
      where: { id: ticketLineId },
    });
    if (!ticketLine) return Response.json({ error: "Ticket line not found" }, { status: 404 });

    const cleanedNotes = (ticketLine.notes || "")
      .replace(/Possible match:[^\n]*/gi, "")
      .replace(/\n{2,}/g, "\n")
      .trim() || null;

    const updated = await prisma.backlogTicketLine.update({
      where: { id: ticketLineId },
      data: { notes: cleanedNotes },
    });

    return Response.json({ ok: true, ticketLine: updated });
  } catch (err) {
    console.error("reject-match failed:", err);
    return Response.json({ error: "Failed to reject match" }, { status: 500 });
  }
}

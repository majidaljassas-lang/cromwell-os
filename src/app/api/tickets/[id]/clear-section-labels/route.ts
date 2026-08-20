/**
 * Clear sectionLabel on every TicketLine + QuoteLine on a ticket.
 * Used when section labels carried over from an earlier workflow are now
 * showing up as headers in invoice / PO renderings and need to be removed.
 */
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { id: true, quotes: { select: { id: true } } },
  });
  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const tlUpdate = await tx.ticketLine.updateMany({
      where: { ticketId: id, sectionLabel: { not: null } },
      data: { sectionLabel: null },
    });
    const quoteIds = ticket.quotes.map((q) => q.id);
    let qlCount = 0;
    if (quoteIds.length > 0) {
      const r = await tx.quoteLine.updateMany({
        where: { quoteId: { in: quoteIds }, sectionLabel: { not: null } },
        data: { sectionLabel: null },
      });
      qlCount = r.count;
    }
    return { ticketLinesCleared: tlUpdate.count, quoteLinesCleared: qlCount };
  });

  return Response.json({ ok: true, ...result });
}

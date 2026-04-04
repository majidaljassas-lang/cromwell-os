import { prisma } from "@/lib/prisma";

/**
 * POST: Run matching between ticket lines and invoice lines for a case.
 * Body: { caseId }
 *
 * Matches by: normalizedProduct + site (Dellow Centre).
 * Allows 1:many and many:1 matching.
 */
export async function POST(request: Request) {
  try {
    const { caseId } = await request.json();
    if (!caseId) return Response.json({ error: "caseId required" }, { status: 400 });

    // Clear existing matches
    const existingMatches = await prisma.backlogInvoiceMatch.findMany({
      where: { ticketLine: { caseId } },
      select: { id: true },
    });
    if (existingMatches.length > 0) {
      await prisma.backlogInvoiceMatch.deleteMany({
        where: { id: { in: existingMatches.map((m) => m.id) } },
      });
    }

    const ticketLines = await prisma.backlogTicketLine.findMany({ where: { caseId } });
    const invoiceLines = await prisma.backlogInvoiceLine.findMany({ where: { caseId } });

    let matchCount = 0;

    for (const tl of ticketLines) {
      // Find invoice lines with same normalized product
      const matches = invoiceLines.filter((il) => il.normalizedProduct === tl.normalizedProduct && il.normalizedProduct !== "UNKNOWN");

      if (matches.length > 0) {
        for (const il of matches) {
          // Check if this exact pair already exists
          const existing = await prisma.backlogInvoiceMatch.findFirst({
            where: { ticketLineId: tl.id, invoiceLineId: il.id },
          });
          if (!existing) {
            await prisma.backlogInvoiceMatch.create({
              data: {
                ticketLineId: tl.id,
                invoiceLineId: il.id,
                matchConfidence: 80,
                matchMethod: "NORMALIZED_PRODUCT",
              },
            });
            matchCount++;
          }
        }

        // Update ticket line status
        const totalInvoiced = matches.reduce((s, il) => s + Number(il.qty), 0);
        const requested = Number(tl.requestedQty);
        let status = "UNMATCHED";
        if (totalInvoiced >= requested) status = "COMPLETE";
        else if (totalInvoiced > 0) status = "PARTIAL";

        await prisma.backlogTicketLine.update({
          where: { id: tl.id },
          data: { status },
        });
      }
    }

    return Response.json({ matched: matchCount, ticketLines: ticketLines.length, invoiceLines: invoiceLines.length });
  } catch (error) {
    console.error("Matching failed:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const quotes = await prisma.quote.findMany({
      where: { ticketId: id },
      include: {
        lines: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(quotes);
  } catch (error) {
    console.error("Failed to fetch quotes:", error);
    return Response.json({ error: "Failed to fetch quotes" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { quoteType, customerId, siteId, siteCommercialLinkId, notes } = body;

    if (!quoteType || !customerId) {
      return Response.json(
        { error: "quoteType and customerId are required" },
        { status: 400 }
      );
    }

    // Auto-generate quoteNo
    const quoteNo = `Q-${Date.now()}`;

    // Determine version number
    const latestQuote = await prisma.quote.findFirst({
      where: { ticketId: id },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    const versionNo = (latestQuote?.versionNo ?? 0) + 1;

    // Get all ticket lines for this ticket
    const ticketLines = await prisma.ticketLine.findMany({
      where: { ticketId: id },
    });

    // Calculate total sell from lines
    let totalSell = 0;
    const quoteLineData = ticketLines.map((line) => {
      const unitPrice = Number(line.actualSaleUnit ?? line.suggestedSaleUnit ?? 0);
      const lineTotal = unitPrice * Number(line.qty);
      totalSell += lineTotal;
      return {
        ticketLineId: line.id,
        description: line.description,
        qty: line.qty,
        unitPrice,
        lineTotal,
      };
    });

    const quote = await prisma.$transaction(async (tx) => {
      const created = await tx.quote.create({
        data: {
          ticketId: id,
          quoteNo,
          versionNo,
          quoteType,
          customerId,
          siteId,
          siteCommercialLinkId,
          status: "DRAFT",
          totalSell,
          notes,
          lines: {
            create: quoteLineData,
          },
        },
        include: {
          lines: { include: { ticketLine: true } },
          customer: true,
        },
      });

      // Update ticket status to QUOTED
      await tx.ticket.update({
        where: { id },
        data: { status: "QUOTED", quoteStatus: "DRAFT" },
      });

      return created;
    });

    await prisma.event.create({
      data: {
        ticketId: id,
        eventType: "QUOTE_REQUESTED",
        timestamp: new Date(),
        notes: `Quote ${quote.quoteNo} created for ${quote.customer?.name || 'Unknown'}`,
      },
    });

    return Response.json(quote, { status: 201 });
  } catch (error) {
    console.error("Failed to create quote:", error);
    return Response.json({ error: "Failed to create quote" }, { status: 500 });
  }
}

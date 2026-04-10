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
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch quotes" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { quoteType, customerId, siteId, siteCommercialLinkId, notes, lineIds } = body;

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

    // Get ticket lines — filter by selected lineIds if provided
    const ticketLines = await prisma.ticketLine.findMany({
      where: {
        ticketId: id,
        ...(lineIds && lineIds.length > 0 ? { id: { in: lineIds } } : {}),
      },
    });

    // FILTER OUT lines with no unit price (only quote priced lines)
    const pricedLines = ticketLines.filter((line) => {
      const price = Number(line.actualSaleUnit ?? line.suggestedSaleUnit ?? 0);
      return price > 0;
    });

    if (pricedLines.length === 0) {
      return Response.json({ error: "No priced lines to quote" }, { status: 400 });
    }

    // Calculate total sell from priced lines only
    let totalSell = 0;
    const quoteLineData = pricedLines.map((line) => {
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

      // Auto-generate Deal Sheet from the same data
      const existingDealSheet = await tx.dealSheet.findFirst({
        where: { ticketId: id },
        orderBy: { versionNo: "desc" },
        select: { versionNo: true },
      });
      const dsVersion = (existingDealSheet?.versionNo ?? 0) + 1;

      let totalExpectedCost = 0;
      let totalExpectedSell = 0;
      const dsLineData = ticketLines.map((line) => {
        const costUnit = Number(line.expectedCostUnit ?? 0);
        const sellUnit = Number(line.actualSaleUnit ?? line.suggestedSaleUnit ?? 0);
        const qty = Number(line.qty);
        totalExpectedCost += costUnit * qty;
        totalExpectedSell += sellUnit * qty;
        return {
          ticketLineId: line.id,
          versionNo: dsVersion,
          supplierSourceSummary: line.supplierName || null,
          benchmarkUnit: line.benchmarkUnit ?? null,
          expectedCostUnit: costUnit,
          suggestedSaleUnit: sellUnit,
          actualSaleUnit: line.actualSaleUnit ?? null,
          expectedMarginUnit: sellUnit - costUnit,
        };
      });

      await tx.dealSheet.create({
        data: {
          ticketId: id,
          versionNo: dsVersion,
          mode: quoteType === "COMPETITIVE_BID" ? "COMPETITIVE" : "STANDARD",
          status: "DRAFT",
          totalExpectedCost,
          totalExpectedSell,
          totalExpectedMargin: totalExpectedSell - totalExpectedCost,
          lineSnapshots: { create: dsLineData },
        },
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
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create quote" }, { status: 500 });
  }
}

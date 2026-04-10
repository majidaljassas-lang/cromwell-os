import { prisma } from "@/lib/prisma";

type CompetitiveBidItem = {
  description: string;
  qty: number;
  competitorPrice: number;
  utopiaPrice?: number;
  bestOnlinePrice?: number;
  ourCost?: number;
  ourPrice?: number;
};

type CompetitiveBidBody = {
  items: CompetitiveBidItem[];
  competitorName: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const body: CompetitiveBidBody = await request.json();
    const { items, competitorName } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return Response.json(
        { error: "items array is required and must not be empty" },
        { status: 400 }
      );
    }

    if (!competitorName) {
      return Response.json(
        { error: "competitorName is required" },
        { status: 400 }
      );
    }

    // Verify ticket exists and get paying customer
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, payingCustomerId: true },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Find the latest comp sheet version number
    const latestSheet = await prisma.compSheet.findFirst({
      where: { ticketId },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });

    const nextVersion = (latestSheet?.versionNo ?? 0) + 1;

    // Create comp sheet
    const compSheet = await prisma.compSheet.create({
      data: {
        ticketId,
        versionNo: nextVersion,
        name: `Competitive Bid vs ${competitorName}`,
        status: "DRAFT",
        notes: `Competitor: ${competitorName}. ${items.length} item(s) compared.`,
      },
    });

    // Create ticket lines and comp sheet lines for each item
    const createdLines = [];
    for (const item of items) {
      const numQty = Number(item.qty || 1);
      const competitorUnitPrice = Number(item.competitorPrice || 0);
      const benchmarkTotal = competitorUnitPrice * numQty;
      const ourCostUnit = Number(item.ourCost || 0);
      const ourSaleUnit = Number(item.ourPrice || 0);
      const ourCostTotal = ourCostUnit > 0 ? ourCostUnit * numQty : undefined;
      const ourSaleTotal = ourSaleUnit > 0 ? ourSaleUnit * numQty : undefined;

      // Determine status based on pricing
      let status: "CAPTURED" | "PRICED" | "READY_FOR_QUOTE" = "CAPTURED";
      if (ourCostUnit > 0 && ourSaleUnit > 0) {
        status = "READY_FOR_QUOTE";
      } else if (ourCostUnit > 0 || ourSaleUnit > 0) {
        status = "PRICED";
      }

      // Create ticket line
      const ticketLine = await prisma.ticketLine.create({
        data: {
          ticketId,
          lineType: "MATERIAL",
          description: item.description,
          qty: numQty,
          unit: "EA",
          payingCustomerId: ticket.payingCustomerId,
          status,
          benchmarkUnit: competitorUnitPrice > 0 ? competitorUnitPrice : undefined,
          benchmarkTotal: benchmarkTotal > 0 ? benchmarkTotal : undefined,
          expectedCostUnit: ourCostUnit > 0 ? ourCostUnit : undefined,
          expectedCostTotal: ourCostTotal,
          actualSaleUnit: ourSaleUnit > 0 ? ourSaleUnit : undefined,
          actualSaleTotal: ourSaleTotal,
          internalNotes: `Competitive bid vs ${competitorName}. Competitor: £${competitorUnitPrice.toFixed(2)}/ea${item.utopiaPrice ? `, Utopia: £${Number(item.utopiaPrice).toFixed(2)}/ea` : ""}${item.bestOnlinePrice ? `, Best Online: £${Number(item.bestOnlinePrice).toFixed(2)}/ea` : ""}`,
        },
      });

      // Create comp sheet line
      const savingTotal =
        ourSaleUnit > 0 && competitorUnitPrice > 0
          ? (competitorUnitPrice - ourSaleUnit) * numQty
          : undefined;
      const marginTotal =
        ourSaleUnit > 0 && ourCostUnit > 0
          ? (ourSaleUnit - ourCostUnit) * numQty
          : undefined;

      const compSheetLine = await prisma.compSheetLine.create({
        data: {
          compSheetId: compSheet.id,
          ticketLineId: ticketLine.id,
          benchmarkTotal: benchmarkTotal > 0 ? benchmarkTotal : undefined,
          ourCostTotal: ourCostTotal,
          ourSaleTotal: ourSaleTotal,
          savingTotal,
          marginTotal,
          notes: JSON.stringify({
            competitorName,
            competitorUnitPrice,
            utopiaUnitPrice: item.utopiaPrice || null,
            bestOnlineUnitPrice: item.bestOnlinePrice || null,
          }),
        },
      });

      createdLines.push({
        ticketLine,
        compSheetLine,
      });
    }

    // Re-fetch the complete comp sheet with lines
    const result = await prisma.compSheet.findUnique({
      where: { id: compSheet.id },
      include: {
        lines: {
          include: { ticketLine: true },
        },
      },
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create competitive bid:", error);
    return Response.json(
      {
        error:
          "Failed to create competitive bid: " +
          (error instanceof Error ? error.message : "unknown"),
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    // Fetch comp sheets that look like competitive bids (name starts with "Competitive Bid")
    const compSheets = await prisma.compSheet.findMany({
      where: {
        ticketId,
        name: { startsWith: "Competitive Bid" },
      },
      include: {
        lines: {
          include: { ticketLine: true },
        },
      },
      orderBy: { versionNo: "desc" },
    });

    return Response.json(compSheets);
  } catch (error) {
    console.error("Failed to fetch competitive bids:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch competitive bids" },
      { status: 500 }
    );
  }
}

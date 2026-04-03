import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { mode, benchmarkContext, strategyNotes } = body;

    if (!mode) {
      return Response.json({ error: "mode is required" }, { status: 400 });
    }

    // Find the latest version number for this ticket
    const latestDealSheet = await prisma.dealSheet.findFirst({
      where: { ticketId: id },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });

    const nextVersionNo = (latestDealSheet?.versionNo ?? 0) + 1;

    // Get all ticket lines for this ticket
    const ticketLines = await prisma.ticketLine.findMany({
      where: { ticketId: id },
    });

    // Create the deal sheet with line snapshots in a transaction
    const dealSheet = await prisma.dealSheet.create({
      data: {
        ticketId: id,
        versionNo: nextVersionNo,
        mode,
        benchmarkContext,
        strategyNotes,
        status: "DRAFT",
        lineSnapshots: {
          create: ticketLines.map((line) => ({
            ticketLineId: line.id,
            versionNo: nextVersionNo,
            benchmarkUnit: line.benchmarkUnit,
            expectedCostUnit: line.expectedCostUnit,
            suggestedSaleUnit: line.suggestedSaleUnit,
            actualSaleUnit: line.actualSaleUnit,
          })),
        },
      },
      include: {
        lineSnapshots: {
          include: { ticketLine: true },
        },
      },
    });

    return Response.json(dealSheet, { status: 201 });
  } catch (error) {
    console.error("Failed to create deal sheet version:", error);
    return Response.json({ error: "Failed to create deal sheet version" }, { status: 500 });
  }
}

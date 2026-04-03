import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        lines: {
          select: {
            id: true, description: true, status: true, unit: true, qty: true,
            expectedCostUnit: true, expectedCostTotal: true,
            suggestedSaleUnit: true, actualSaleUnit: true, actualSaleTotal: true,
            actualMarginTotal: true,
          },
        },
      },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    const totalLines = ticket.lines.length;
    const readyLines = ticket.lines.filter((l) => l.status === "READY_FOR_QUOTE");
    const pricedLines = ticket.lines.filter((l) => l.status === "PRICED");
    const capturedLines = ticket.lines.filter((l) => l.status === "CAPTURED");

    const issues: Array<{ lineId: string; description: string; issue: string }> = [];

    for (const line of ticket.lines) {
      if (!line.expectedCostUnit || Number(line.expectedCostUnit) === 0) {
        issues.push({ lineId: line.id, description: line.description, issue: "Missing expected cost" });
      }
      if (!line.suggestedSaleUnit && !line.actualSaleUnit) {
        issues.push({ lineId: line.id, description: line.description, issue: "Missing sale price" });
      }
      if (!line.qty || Number(line.qty) === 0) {
        issues.push({ lineId: line.id, description: line.description, issue: "Zero quantity" });
      }
    }

    const isQuoteReady = totalLines > 0 && readyLines.length === totalLines;

    // Totals (EX VAT only)
    const totalExpectedCost = ticket.lines.reduce((s, l) => s + Number(l.expectedCostTotal || 0), 0);
    const totalSaleValue = ticket.lines.reduce((s, l) => s + Number(l.actualSaleTotal || 0), 0);
    const totalMargin = ticket.lines.reduce((s, l) => s + Number(l.actualMarginTotal || 0), 0);
    const marginPct = totalSaleValue > 0 ? (totalMargin / totalSaleValue) * 100 : 0;

    return Response.json({
      ticketId: id,
      isQuoteReady,
      summary: {
        totalLines,
        readyForQuote: readyLines.length,
        priced: pricedLines.length,
        captured: capturedLines.length,
      },
      commercials: {
        totalExpectedCost: Math.round(totalExpectedCost * 100) / 100,
        totalSaleValue: Math.round(totalSaleValue * 100) / 100,
        totalMargin: Math.round(totalMargin * 100) / 100,
        marginPct: Math.round(marginPct * 100) / 100,
      },
      issues,
    });
  } catch (error) {
    console.error("Failed to check readiness:", error);
    return Response.json({ error: "Failed to check readiness" }, { status: 500 });
  }
}

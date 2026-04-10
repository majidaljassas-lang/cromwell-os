import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { competitorUnitPrice, utopiaUnitPrice, bestOnlineUnitPrice } = body;

    // Get current line
    const current = await prisma.compSheetLine.findUnique({
      where: { id },
      include: { ticketLine: true },
    });
    if (!current) {
      return Response.json({ error: "Comp sheet line not found" }, { status: 404 });
    }

    // Parse existing notes (JSON metadata)
    let meta: { competitorName?: string; competitorUnitPrice?: number; utopiaUnitPrice?: number; bestOnlineUnitPrice?: number } = {};
    try {
      if (current.notes) meta = JSON.parse(current.notes);
    } catch {}

    // Update meta
    if (competitorUnitPrice !== undefined) meta.competitorUnitPrice = competitorUnitPrice;
    if (utopiaUnitPrice !== undefined) meta.utopiaUnitPrice = utopiaUnitPrice;
    if (bestOnlineUnitPrice !== undefined) meta.bestOnlineUnitPrice = bestOnlineUnitPrice;

    // Recalculate benchmark total
    const qty = Number(current.ticketLine?.qty || 0);
    const benchmarkTotal = (meta.competitorUnitPrice || 0) * qty;

    const updated = await prisma.compSheetLine.update({
      where: { id },
      data: {
        notes: JSON.stringify(meta),
        benchmarkTotal: benchmarkTotal > 0 ? benchmarkTotal : undefined,
      },
    });

    // Also update the ticket line's benchmarkUnit so it shows on the lines tab
    if (current.ticketLineId && competitorUnitPrice !== undefined) {
      await prisma.ticketLine.update({
        where: { id: current.ticketLineId },
        data: {
          benchmarkUnit: competitorUnitPrice || undefined,
          benchmarkTotal: benchmarkTotal > 0 ? benchmarkTotal : undefined,
        },
      });
    }

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update comp sheet line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update comp sheet line" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

/**
 * Create Purchase Plan — generates one PO per supplier from ticket lines.
 * Only runs when quote is ACCEPTED.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        lines: {
          select: {
            id: true, description: true, qty: true, unit: true,
            expectedCostUnit: true, expectedCostTotal: true,
            supplierId: true, supplierName: true, supplierReference: true,
          },
        },
        quotes: {
          where: { status: "APPROVED" },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (ticket.quotes.length === 0) {
      return Response.json({ error: "No accepted quote on this ticket. Accept a quote first." }, { status: 422 });
    }

    // Group lines by supplier
    const bySupplier: Record<string, typeof ticket.lines> = {};
    const unassigned: typeof ticket.lines = [];

    for (const line of ticket.lines) {
      if (line.supplierId) {
        const key = line.supplierId;
        if (!bySupplier[key]) bySupplier[key] = [];
        bySupplier[key].push(line);
      } else {
        unassigned.push(line);
      }
    }

    if (Object.keys(bySupplier).length === 0) {
      return Response.json({
        error: "No lines have suppliers assigned. Assign suppliers to ticket lines first.",
        unassignedCount: unassigned.length,
      }, { status: 422 });
    }

    // Create one ProcurementOrder per supplier
    const createdPOs = [];

    for (const [supplierId, lines] of Object.entries(bySupplier)) {
      const supplierName = lines[0].supplierName || "Unknown";
      const totalCost = lines.reduce((s, l) => s + Number(l.expectedCostTotal || 0), 0);
      const poNo = `PO-${supplierName.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

      const po = await prisma.procurementOrder.create({
        data: {
          ticketId,
          supplierId,
          poNo,
          supplierRef: lines[0].supplierReference || undefined,
          status: "DRAFT",
          totalCostExpected: totalCost,
          issuedAt: new Date(),
          lines: {
            create: lines.map((line) => ({
              ticketLineId: line.id,
              description: line.description,
              qty: Number(line.qty),
              unitCost: Number(line.expectedCostUnit || 0),
              lineTotal: Number(line.expectedCostTotal || 0),
            })),
          },
        },
        include: {
          supplier: { select: { id: true, name: true } },
          lines: { include: { ticketLine: { select: { id: true, description: true } } } },
        },
      });

      createdPOs.push(po);
    }

    // Update ticket status
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "ORDERED" },
    });

    return Response.json({
      created: createdPOs.length,
      unassignedLines: unassigned.length,
      purchaseOrders: createdPOs,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create purchase plan:", error);
    return Response.json({ error: "Failed to create purchase plan" }, { status: 500 });
  }
}

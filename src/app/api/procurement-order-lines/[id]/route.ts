import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.procurementOrderLine.findUnique({
      where: { id },
    });

    if (!existing) {
      return Response.json(
        { error: "Procurement order line not found" },
        { status: 404 }
      );
    }

    const { unitCost, lineTotal, supplierCode } = body;

    const updated = await prisma.procurementOrderLine.update({
      where: { id },
      data: {
        ...(unitCost !== undefined && { unitCost }),
        ...(lineTotal !== undefined && { lineTotal }),
        // Note: supplierCode could be stored in notes or a new field if needed
        // For now, we're just updating the standard fields
      },
      include: {
        procurementOrder: true,
        ticketLine: true,
        supplierOption: true,
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update procurement order line:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update procurement order line" },
      { status: 500 }
    );
  }
}

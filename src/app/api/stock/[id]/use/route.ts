import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: stockItemId } = await params;
  try {
    const body = await request.json();
    const { ticketLineId, qtyUsed } = body;

    if (!ticketLineId || !qtyUsed || Number(qtyUsed) <= 0) {
      return Response.json({ error: "ticketLineId and qtyUsed > 0 required" }, { status: 400 });
    }

    const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!stockItem) {
      return Response.json({ error: "Stock item not found" }, { status: 404 });
    }

    const qty = Number(qtyUsed);
    const available = Number(stockItem.qtyOnHand);
    if (qty > available) {
      return Response.json({ error: `Only ${available} available in stock` }, { status: 400 });
    }

    const costPerUnit = Number(stockItem.costPerUnit);
    const totalCost = costPerUnit * qty;
    const newQty = available - qty;

    // Build stock item update — mark as ALLOCATED if fully consumed
    const stockUpdate: Record<string, unknown> = { qtyOnHand: newQty };
    if (newQty <= 0) {
      stockUpdate.outcome = "ALLOCATED";
      stockUpdate.outcomeDate = new Date();
    }

    // Create usage record and deduct stock
    const [usage] = await prisma.$transaction([
      prisma.stockUsage.create({
        data: {
          stockItemId,
          ticketLineId,
          qtyUsed: qty,
          costPerUnit,
          totalCost,
          notes: body.notes || null,
        },
      }),
      prisma.stockItem.update({
        where: { id: stockItemId },
        data: stockUpdate,
      }),
    ]);

    return Response.json(usage, { status: 201 });
  } catch (error) {
    console.error("Failed to use stock:", error);
    return Response.json({ error: "Failed to use stock" }, { status: 500 });
  }
}

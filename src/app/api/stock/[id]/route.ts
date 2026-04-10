import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    const fields = [
      "description", "productCode", "category", "qtyOnHand",
      "unit", "costPerUnit", "sourceType", "supplierName",
      "originTicketId", "originTicketTitle", "originBillNo", "originBillId",
      "outcome", "outcomeNotes", "notes", "isActive",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) {
        allowed[f] = ["qtyOnHand", "costPerUnit"].includes(f) ? Number(body[f]) : body[f];
      }
    }

    // If marking as resolved (not HOLDING), set outcomeDate
    if (body.outcome && body.outcome !== "HOLDING") {
      allowed.outcomeDate = new Date();
    }

    const item = await prisma.stockItem.update({
      where: { id },
      data: allowed,
    });
    return Response.json(item);
  } catch (error) {
    console.error("Failed to update stock item:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update stock item" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const item = await prisma.stockItem.update({
      where: { id },
      data: { isActive: false },
    });
    return Response.json(item);
  } catch (error) {
    console.error("Failed to delete stock item:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete stock item" }, { status: 500 });
  }
}

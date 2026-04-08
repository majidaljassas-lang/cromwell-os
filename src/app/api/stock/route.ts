import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const outcome = searchParams.get("outcome"); // HOLDING, ALLOCATED, RETURNED_TO_SUPPLIER
  const sourceType = searchParams.get("sourceType"); // RETURN, MOQ_EXCESS

  try {
    const where: Record<string, unknown> = { isActive: true };
    if (outcome) where.outcome = outcome;
    if (sourceType) where.sourceType = sourceType;

    const items = await prisma.stockItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        usages: {
          select: {
            id: true,
            qtyUsed: true,
            totalCost: true,
            ticketLine: { select: { id: true, description: true, ticketId: true } },
          },
        },
      },
    });
    return Response.json(items);
  } catch (error) {
    console.error("Failed to list stock:", error);
    return Response.json({ error: "Failed to list stock" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const qty = Number(body.qtyOnHand);
    const item = await prisma.stockItem.create({
      data: {
        description: body.description,
        productCode: body.productCode || null,
        category: body.category || null,
        qtyOnHand: qty,
        qtyOriginal: qty,
        unit: body.unit || "EA",
        costPerUnit: Number(body.costPerUnit),
        sourceType: body.sourceType || "OTHER",
        supplierName: body.supplierName || null,
        originTicketId: body.originTicketId || null,
        originTicketTitle: body.originTicketTitle || null,
        originBillNo: body.originBillNo || null,
        originBillId: body.originBillId || null,
        notes: body.notes || null,
      },
    });
    return Response.json(item, { status: 201 });
  } catch (error) {
    console.error("Failed to create stock item:", error);
    return Response.json({ error: "Failed to create stock item" }, { status: 500 });
  }
}

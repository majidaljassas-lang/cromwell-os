import { prisma } from "@/lib/prisma";
import { normaliseUom } from "@/lib/commercial/uom";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const orderGroupId = searchParams.get("orderGroupId");
    const productId = searchParams.get("productId");

    const where: Record<string, unknown> = {};
    if (siteId) where.siteId = siteId;
    if (orderGroupId) where.orderGroupId = orderGroupId;
    if (productId) where.canonicalProductId = productId;

    const events = await prisma.orderEvent.findMany({
      where,
      include: {
        orderGroup: true,
        canonicalProduct: true,
      },
      orderBy: { timestamp: "asc" },
    });
    return Response.json(events);
  } catch (error) {
    console.error("Failed to list order events:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to list order events" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      orderGroupId,
      canonicalProductId,
      siteId,
      customerId,
      eventType,
      qty,
      rawUom,
      sourceMessageId,
      sourceText,
      timestamp,
      notes,
    } = body;

    if (!orderGroupId || !canonicalProductId || !siteId || !eventType || qty === undefined || !rawUom) {
      return Response.json(
        { error: "orderGroupId, canonicalProductId, siteId, eventType, qty, rawUom are required" },
        { status: 400 }
      );
    }

    // Look up canonical UOM for the product
    const product = await prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
    });

    if (!product) {
      return Response.json({ error: "Canonical product not found" }, { status: 404 });
    }

    // Normalise UOM
    const uomResult = await normaliseUom(canonicalProductId, qty, rawUom, product.canonicalUom);

    const event = await prisma.orderEvent.create({
      data: {
        orderGroupId,
        canonicalProductId,
        siteId,
        customerId,
        eventType,
        qty,
        rawUom,
        normalisedQty: uomResult.normalisedQty,
        canonicalUom: uomResult.canonicalUom,
        uomResolved: uomResult.uomResolved,
        sourceMessageId,
        sourceText,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        notes,
      },
      include: { orderGroup: true, canonicalProduct: true },
    });

    // If UOM unresolved, create review queue item
    if (!uomResult.uomResolved) {
      await prisma.reviewQueueItem.create({
        data: {
          queueType: "UOM_MISMATCH",
          description: `UOM mismatch for ${product.code}: ${rawUom} → ${product.canonicalUom}. ${uomResult.mismatchReason || ""}`,
          siteId,
          productCode: product.code,
          entityId: event.id,
          entityType: "OrderEvent",
          rawValue: rawUom,
        },
      });
    }

    // Update order group totals
    await recalculateOrderGroupTotals(orderGroupId);

    return Response.json(event, { status: 201 });
  } catch (error) {
    console.error("Failed to create order event:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create order event" }, { status: 500 });
  }
}

async function recalculateOrderGroupTotals(orderGroupId: string) {
  const events = await prisma.orderEvent.findMany({
    where: { orderGroupId },
  });

  let orderedQty = 0;
  for (const oe of events) {
    const qty = oe.uomResolved ? Number(oe.normalisedQty) : Number(oe.qty);
    switch (oe.eventType) {
      case "INITIAL_ORDER":
      case "ADDITION":
      case "SUBSTITUTION_IN":
      case "CONFIRMATION":
        orderedQty += qty;
        break;
      case "REDUCTION":
      case "SUBSTITUTION_OUT":
      case "CANCELLATION":
        orderedQty -= qty;
        break;
    }
  }

  await prisma.orderGroup.update({
    where: { id: orderGroupId },
    data: { orderedQty },
  });
}

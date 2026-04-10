import { prisma } from "@/lib/prisma";
import { normaliseUom } from "@/lib/commercial/uom";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const orderGroupId = searchParams.get("orderGroupId");

    const where: Record<string, unknown> = {};
    if (siteId) where.siteId = siteId;
    if (orderGroupId) where.orderGroupId = orderGroupId;

    const events = await prisma.supplyEvent.findMany({
      where,
      include: { canonicalProduct: true, orderGroup: true },
      orderBy: { timestamp: "asc" },
    });
    return Response.json(events);
  } catch (error) {
    console.error("Failed to list supply events:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to list supply events" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      orderGroupId,
      canonicalProductId,
      siteId,
      fulfilmentType,
      qty,
      rawUom,
      sourceRef,
      evidenceRef,
      timestamp,
      notes,
    } = body;

    if (!canonicalProductId || !siteId || !fulfilmentType || qty === undefined || !rawUom) {
      return Response.json(
        { error: "canonicalProductId, siteId, fulfilmentType, qty, rawUom are required" },
        { status: 400 }
      );
    }

    const product = await prisma.canonicalProduct.findUnique({
      where: { id: canonicalProductId },
    });
    if (!product) {
      return Response.json({ error: "Canonical product not found" }, { status: 404 });
    }

    const uomResult = await normaliseUom(canonicalProductId, qty, rawUom, product.canonicalUom);

    const event = await prisma.supplyEvent.create({
      data: {
        orderGroupId,
        canonicalProductId,
        siteId,
        fulfilmentType,
        qty,
        rawUom,
        normalisedQty: uomResult.normalisedQty,
        canonicalUom: uomResult.canonicalUom,
        uomResolved: uomResult.uomResolved,
        sourceRef,
        evidenceRef,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        notes,
      },
      include: { canonicalProduct: true, orderGroup: true },
    });

    if (!uomResult.uomResolved) {
      await prisma.reviewQueueItem.create({
        data: {
          queueType: "UOM_MISMATCH",
          description: `UOM mismatch for ${product.code}: ${rawUom} → ${product.canonicalUom}`,
          siteId,
          productCode: product.code,
          entityId: event.id,
          entityType: "SupplyEvent",
          rawValue: rawUom,
        },
      });
    }

    // Update order group supply totals if linked
    if (orderGroupId) {
      const supplyEvents = await prisma.supplyEvent.findMany({
        where: { orderGroupId },
      });
      let suppliedQty = 0;
      for (const se of supplyEvents) {
        const q = se.uomResolved ? Number(se.normalisedQty) : Number(se.qty);
        switch (se.fulfilmentType) {
          case "DELIVERED":
          case "PART_DELIVERED":
          case "SUBSTITUTED":
            suppliedQty += q;
            break;
          case "RETURNED":
          case "CREDITED":
            suppliedQty -= q;
            break;
        }
      }
      await prisma.orderGroup.update({
        where: { id: orderGroupId },
        data: { suppliedQty },
      });
    }

    return Response.json(event, { status: 201 });
  } catch (error) {
    console.error("Failed to create supply event:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create supply event" }, { status: 500 });
  }
}

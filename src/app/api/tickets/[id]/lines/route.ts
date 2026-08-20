import { prisma } from "@/lib/prisma";
import { resequenceLines } from "@/lib/tickets/resequence-lines";

const VALID_UOMS = ["EA", "M", "LENGTH", "PACK", "LOT", "SET", "TONNE"] as const;
const DEFAULT_UOM_BY_TYPE: Record<string, string> = {
  MATERIAL: "EA",
  LABOUR: "EA",
  PLANT: "EA",
  SERVICE: "LOT",
  DELIVERY: "LOT",
  CASH_SALE: "LOT",
  RETURN_ADJUSTMENT: "EA",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const body = await request.json();
    const {
      lineType,
      description,
      qty,
      unit,
      payingCustomerId,
      internalNotes,
      expectedCostUnit,
      suggestedSaleUnit,
      actualSaleUnit,
      sectionLabel,
      ...rest
    } = body;

    if (!lineType || !description || qty === undefined || !payingCustomerId) {
      return Response.json(
        { error: "Missing required fields: lineType, description, qty, payingCustomerId" },
        { status: 400 }
      );
    }

    // Resolve UOM — use provided, default by type, or EA
    const resolvedUnit = unit && VALID_UOMS.includes(unit) ? unit : (DEFAULT_UOM_BY_TYPE[lineType] || "EA");

    // Calculate totals
    const numQty = Number(qty);
    const numExpCost = Number(expectedCostUnit || 0);
    const numSuggSale = Number(suggestedSaleUnit || 0);
    const numActSale = Number(actualSaleUnit || 0);

    const expectedCostTotal = numExpCost > 0 ? numExpCost * numQty : undefined;
    const actualSaleTotal = numActSale > 0 ? numActSale * numQty : undefined;
    const expectedMarginTotal = numSuggSale > 0 && numExpCost > 0 ? (numSuggSale - numExpCost) * numQty : undefined;
    const actualMarginTotal = numActSale > 0 && numExpCost > 0 ? (numActSale - numExpCost) * numQty : undefined;

    // Auto-determine initial status
    const hasCost = numExpCost > 0;
    const hasSale = numActSale > 0 || numSuggSale > 0;
    let status: "CAPTURED" | "PRICED" | "READY_FOR_QUOTE" = "CAPTURED";
    if (hasCost && hasSale) {
      status = "READY_FOR_QUOTE";
    } else if (hasCost || hasSale) {
      status = "PRICED";
    }

    // Filter rest to only safe fields
    const safeRest: Record<string, unknown> = {};
    for (const key of ["normalizedItemName", "productCode", "specification", "siteId", "siteCommercialLinkId", "requestedByContactId", "supplierStrategyType", "benchmarkUnit", "benchmarkTotal"]) {
      if (rest[key] !== undefined) safeRest[key] = rest[key];
    }

    // displayOrder: new line goes at the end of its section (or end of ticket if no section).
    // Bump every line at-or-after that slot so we don't collide with existing orders.
    const cleanSection = sectionLabel ? String(sectionLabel).trim() : null;
    const targetForOrder = cleanSection
      ? await prisma.ticketLine.findFirst({
          where: { ticketId, sectionLabel: cleanSection },
          orderBy: { displayOrder: "desc" },
          select: { displayOrder: true },
        })
      : await prisma.ticketLine.findFirst({
          where: { ticketId },
          orderBy: { displayOrder: "desc" },
          select: { displayOrder: true },
        });
    const newOrder = (targetForOrder?.displayOrder ?? 0) + 1;
    if (cleanSection) {
      // Push later lines down by 1 to make room at the end of this section
      await prisma.ticketLine.updateMany({
        where: { ticketId, displayOrder: { gte: newOrder } },
        data: { displayOrder: { increment: 1 } },
      });
    }

    const line = await prisma.ticketLine.create({
      data: {
        ticketId,
        lineType: lineType as "MATERIAL" | "LABOUR" | "PLANT" | "SERVICE" | "DELIVERY" | "CASH_SALE" | "RETURN_ADJUSTMENT",
        description,
        qty: numQty,
        unit: resolvedUnit as "EA" | "M" | "LENGTH" | "PACK" | "LOT" | "SET" | "TONNE",
        payingCustomerId,
        internalNotes,
        status,
        expectedCostUnit: numExpCost > 0 ? numExpCost : undefined,
        expectedCostTotal,
        suggestedSaleUnit: numSuggSale > 0 ? numSuggSale : undefined,
        actualSaleUnit: numActSale > 0 ? numActSale : undefined,
        actualSaleTotal,
        expectedMarginTotal,
        actualMarginTotal,
        sectionLabel: cleanSection || undefined,
        displayOrder: newOrder,
        ...safeRest,
      },
    });

    // Keep every section a single contiguous block — guards against future fragmentation
    await resequenceLines(ticketId);

    // If this line has a section label, create an event linked to the line
    if (sectionLabel) {
      await prisma.event.create({
        data: {
          ticketId,
          ticketLineId: line.id,
          eventType: "EXTRA_ORDER_ADDED",
          timestamp: new Date(),
          sourceRef: rest.sectionSource || undefined,
          notes: `${sectionLabel}: ${description}`,
        },
      });
    }

    return Response.json(line, { status: 201 });
  } catch (error) {
    console.error("Failed to create ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create ticket line" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

const VALID_UOMS = ["EA", "M", "LENGTH", "PACK", "LOT", "SET"] as const;
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

    const line = await prisma.ticketLine.create({
      data: {
        ticketId,
        lineType: lineType as "MATERIAL" | "LABOUR" | "PLANT" | "SERVICE" | "DELIVERY" | "CASH_SALE" | "RETURN_ADJUSTMENT",
        description,
        qty: numQty,
        unit: resolvedUnit as "EA" | "M" | "LENGTH" | "PACK" | "LOT" | "SET",
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
        ...safeRest,
      },
    });

    return Response.json(line, { status: 201 });
  } catch (error) {
    console.error("Failed to create ticket line:", error);
    return Response.json({ error: "Failed to create ticket line" }, { status: 500 });
  }
}

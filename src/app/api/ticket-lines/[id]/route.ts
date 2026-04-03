import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const line = await prisma.ticketLine.findUnique({
      where: { id },
      include: {
        ticket: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
      },
    });
    if (!line) {
      return Response.json({ error: "Ticket line not found" }, { status: 404 });
    }
    return Response.json(line);
  } catch (error) {
    console.error("Failed to get ticket line:", error);
    return Response.json({ error: "Failed to get ticket line" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();

    // Whitelist allowed fields
    const allowed: Record<string, unknown> = {};
    const fields = [
      "description", "normalizedItemName", "productCode", "specification",
      "internalNotes", "qty", "unit", "lineType",
      "expectedCostUnit", "expectedCostTotal", "actualCostTotal",
      "benchmarkUnit", "benchmarkTotal",
      "suggestedSaleUnit", "actualSaleUnit", "actualSaleTotal",
      "expectedMarginTotal", "actualMarginTotal", "varianceTotal",
      "evidenceStatus", "costStatus", "salesStatus",
      "supplierStrategyType", "siteId", "siteCommercialLinkId",
      "supplierId", "supplierName", "supplierReference",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }

    // Auto-calculate totals if unit prices change
    const current = await prisma.ticketLine.findUnique({ where: { id }, select: { qty: true, expectedCostUnit: true, suggestedSaleUnit: true, actualSaleUnit: true } });
    if (!current) return Response.json({ error: "Not found" }, { status: 404 });

    const qty = Number(allowed.qty ?? current.qty);
    const expectedCostUnit = Number(allowed.expectedCostUnit ?? current.expectedCostUnit ?? 0);
    const suggestedSaleUnit = Number(allowed.suggestedSaleUnit ?? current.suggestedSaleUnit ?? 0);
    const actualSaleUnit = Number(allowed.actualSaleUnit ?? current.actualSaleUnit ?? 0);

    // Auto-calculate derived fields
    if (allowed.expectedCostUnit !== undefined || allowed.qty !== undefined) {
      allowed.expectedCostTotal = expectedCostUnit * qty;
    }
    if (allowed.actualSaleUnit !== undefined || allowed.qty !== undefined) {
      allowed.actualSaleTotal = actualSaleUnit * qty;
    }
    if (allowed.suggestedSaleUnit !== undefined || allowed.expectedCostUnit !== undefined) {
      allowed.expectedMarginTotal = (suggestedSaleUnit - expectedCostUnit) * qty;
    }
    if (allowed.actualSaleUnit !== undefined || allowed.expectedCostUnit !== undefined) {
      allowed.actualMarginTotal = (actualSaleUnit - expectedCostUnit) * qty;
      allowed.varianceTotal = (actualSaleUnit - suggestedSaleUnit) * qty;
    }

    // Fix 5: Auto-status progression
    const hasExpectedCost = expectedCostUnit > 0 || Number(allowed.expectedCostTotal || 0) > 0;
    const hasSalePrice = actualSaleUnit > 0 || suggestedSaleUnit > 0;

    if (hasExpectedCost && hasSalePrice) {
      // Both cost and sale present — check if ready for quote
      const hasQty = qty > 0;
      const hasDescription = true; // already required on create
      if (hasQty && hasDescription) {
        allowed.status = "READY_FOR_QUOTE";
      } else {
        allowed.status = "PRICED";
      }
    } else if (hasExpectedCost || hasSalePrice) {
      allowed.status = "PRICED";
    }
    // If neither, stay at current status (don't regress)

    // Don't override manually set status if it's further along
    if (body.status !== undefined) {
      allowed.status = body.status;
    }

    const line = await prisma.ticketLine.update({
      where: { id },
      data: allowed,
    });

    return Response.json(line);
  } catch (error) {
    console.error("Failed to update ticket line:", error);
    return Response.json({ error: "Failed to update ticket line" }, { status: 500 });
  }
}

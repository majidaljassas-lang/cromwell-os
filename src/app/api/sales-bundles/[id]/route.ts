import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bundle = await prisma.salesBundle.findUnique({
      where: { id },
      include: {
        costLinks: {
          include: { ticketLine: true },
        },
      },
    });

    if (!bundle) {
      return Response.json({ error: "Sales bundle not found" }, { status: 404 });
    }

    return Response.json(bundle);
  } catch (error) {
    console.error("Failed to fetch sales bundle:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch sales bundle" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const bundle = await prisma.salesBundle.update({
      where: { id },
      data: body,
    });

    return Response.json(bundle);
  } catch (error) {
    console.error("Failed to update sales bundle:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update sales bundle" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { ticketLineId, linkedCostValue, linkedQty, contributionType } = body;

    if (!ticketLineId || !contributionType) {
      return Response.json(
        { error: "ticketLineId and contributionType are required" },
        { status: 400 }
      );
    }

    // Check: block if any cost allocation on this ticket line comes from a BLOCKED_VAT_UNKNOWN bill line
    const blockedAllocations = await prisma.costAllocation.findMany({
      where: {
        ticketLineId,
        supplierBillLine: { commercialStatus: "BLOCKED_VAT_UNKNOWN" },
      },
    });
    if (blockedAllocations.length > 0) {
      return Response.json(
        { error: "Cannot add to bundle — ticket line has cost allocations from VAT-blocked bill lines" },
        { status: 422 }
      );
    }

    const costLink = await prisma.salesBundleCostLink.create({
      data: {
        salesBundleId: id,
        ticketLineId,
        linkedCostValue,
        linkedQty,
        contributionType,
      },
      include: { ticketLine: true },
    });

    // Fix 4: Auto-populate bundle pricing after adding cost link
    const allLinks = await prisma.salesBundleCostLink.findMany({
      where: { salesBundleId: id },
      include: { ticketLine: { select: { suggestedSaleUnit: true, qty: true, actualSaleUnit: true } } },
    });

    const targetSellTotal = allLinks.reduce((sum, link) => {
      const saleUnit = Number(link.ticketLine.actualSaleUnit ?? link.ticketLine.suggestedSaleUnit ?? 0);
      return sum + saleUnit * Number(link.ticketLine.qty);
    }, 0);

    const bundle = await prisma.salesBundle.findUnique({ where: { id } });
    const previousTarget = bundle?.targetSellTotal ? Number(bundle.targetSellTotal) : null;

    await prisma.salesBundle.update({
      where: { id },
      data: {
        targetSellTotal,
        actualSellTotal: bundle?.actualSellTotal ? undefined : targetSellTotal,
      },
    });

    // Audit if price changed
    if (previousTarget !== targetSellTotal) {
      const { logAudit } = await import("@/lib/ingestion/audit");
      await logAudit({
        objectType: "SalesBundle",
        objectId: id,
        actionType: "PRICING_AUTO_POPULATED",
        previousValue: { targetSellTotal: previousTarget },
        newValue: { targetSellTotal },
        reason: "Auto-calculated from linked ticket line sell prices",
      });
    }

    return Response.json(costLink, { status: 201 });
  } catch (error) {
    console.error("Failed to add cost link:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to add cost link" }, { status: 500 });
  }
}

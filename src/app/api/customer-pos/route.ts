import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const poType = searchParams.get("poType");
    const customerId = searchParams.get("customerId");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (poType)
      where.poType = poType as
        | "STANDARD_FIXED"
        | "DRAWDOWN_LABOUR"
        | "DRAWDOWN_MATERIALS";
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const pos = await prisma.customerPO.findMany({
      where,
      include: {
        customer: true,
        site: true,
        siteCommercialLink: true,
        ticket: true,
        lines: true,
        _count: {
          select: {
            labourDrawdowns: true,
            materialsDrawdowns: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(pos);
  } catch (error) {
    console.error("Failed to list customer POs:", error);
    return Response.json(
      { error: "Failed to list customer POs" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      ticketId,
      customerId,
      siteId,
      siteCommercialLinkId,
      poNo,
      poType,
      poDate,
      status = "RECEIVED",
      totalValue,
      poLimitValue,
      overheadPct,
      overheadBasis,
      weekdaySellRate,
      weekendSellRate,
      weekdayCostRate,
      weekendCostRate,
      sourceAttachmentRef,
      notes,
    } = body;

    if (!customerId || !poNo || !poType) {
      return Response.json(
        { error: "Missing required fields: customerId, poNo, poType" },
        { status: 400 }
      );
    }

    const poRemainingValue = poLimitValue ?? totalValue ?? 0;

    const po = await prisma.customerPO.create({
      data: {
        ticketId,
        customerId,
        siteId,
        siteCommercialLinkId,
        poNo,
        poType: poType as
          | "STANDARD_FIXED"
          | "DRAWDOWN_LABOUR"
          | "DRAWDOWN_MATERIALS",
        poDate: poDate ? new Date(poDate) : undefined,
        status,
        totalValue,
        poLimitValue,
        poRemainingValue,
        overheadPct,
        overheadBasis,
        weekdaySellRate,
        weekendSellRate,
        weekdayCostRate,
        weekendCostRate,
        sourceAttachmentRef,
        notes,
      },
      include: {
        customer: true,
        site: true,
        siteCommercialLink: true,
        ticket: true,
        lines: true,
        _count: {
          select: {
            labourDrawdowns: true,
            materialsDrawdowns: true,
          },
        },
      },
    });

    return Response.json(po, { status: 201 });
  } catch (error) {
    console.error("Failed to create customer PO:", error);
    return Response.json(
      { error: "Failed to create customer PO" },
      { status: 500 }
    );
  }
}

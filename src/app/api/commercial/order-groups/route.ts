import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    const where: Record<string, unknown> = {};
    if (siteId) where.siteId = siteId;

    const groups = await prisma.orderGroup.findMany({
      where,
      include: {
        site: true,
        orderEvents: {
          include: { canonicalProduct: true },
          orderBy: { timestamp: "asc" },
        },
        supplyEvents: {
          include: { canonicalProduct: true },
          orderBy: { timestamp: "asc" },
        },
        invoiceLineAllocations: {
          include: {
            commercialInvoiceLine: {
              include: { commercialInvoice: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(groups);
  } catch (error) {
    console.error("Failed to list order groups:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to list order groups" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId, customerId, label, description } = body;

    if (!siteId || !label) {
      return Response.json({ error: "siteId and label are required" }, { status: 400 });
    }

    // Verify site exists
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      include: {
        siteCommercialLinks: {
          where: { isActive: true, billingAllowed: true },
          orderBy: [{ defaultBillingCustomer: "desc" }],
          take: 1,
        },
      },
    });
    if (!site) {
      return Response.json({ error: "Site not found. No auto site creation allowed." }, { status: 404 });
    }

    const resolvedCustomerId = customerId ?? site.siteCommercialLinks[0]?.customerId;
    if (!resolvedCustomerId) {
      return Response.json(
        {
          error: "CUSTOMER_REQUIRED",
          message: "Order groups require a customer. Provide customerId or ensure the site " +
            "has an active SiteCommercialLink with billingAllowed=true.",
          field: "customerId",
        },
        { status: 422 }
      );
    }

    const group = await prisma.orderGroup.create({
      data: { siteId, customerId: resolvedCustomerId, label, description },
      include: { site: true },
    });
    return Response.json(group, { status: 201 });
  } catch (error) {
    console.error("Failed to create order group:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create order group" }, { status: 500 });
  }
}

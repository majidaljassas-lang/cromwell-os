import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bundles = await prisma.salesBundle.findMany({
      where: { ticketId: id },
      include: {
        costLinks: {
          include: { ticketLine: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(bundles);
  } catch (error) {
    console.error("Failed to fetch sales bundles:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch sales bundles" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description, bundleType, pricingMode, targetSellTotal, status } = body;

    if (!name || !bundleType || !pricingMode) {
      return Response.json(
        { error: "name, bundleType, and pricingMode are required" },
        { status: 400 }
      );
    }

    const bundle = await prisma.salesBundle.create({
      data: {
        ticketId: id,
        name,
        description,
        bundleType,
        pricingMode,
        targetSellTotal,
        status: status ?? "DRAFT",
      },
    });

    return Response.json(bundle, { status: 201 });
  } catch (error) {
    console.error("Failed to create sales bundle:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create sales bundle" }, { status: 500 });
  }
}

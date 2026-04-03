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
    return Response.json({ error: "Failed to fetch sales bundle" }, { status: 500 });
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
    return Response.json({ error: "Failed to update sales bundle" }, { status: 500 });
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

    return Response.json(costLink, { status: 201 });
  } catch (error) {
    console.error("Failed to add cost link:", error);
    return Response.json({ error: "Failed to add cost link" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const options = await prisma.supplierOption.findMany({
      where: {
        ticketLine: { ticketId: id },
      },
      include: {
        supplier: true,
        ticketLine: true,
      },
      orderBy: { ticketLineId: "asc" },
    });

    return Response.json(options);
  } catch (error) {
    console.error("Failed to fetch supplier options:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch supplier options" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params;
    const body = await request.json();
    const {
      ticketLineId,
      supplierId,
      sourceType,
      costUnit,
      qtyAvailable,
      leadTimeDays,
      isPreferred,
      notes,
    } = body;

    if (!ticketLineId || !supplierId || !sourceType || costUnit === undefined) {
      return Response.json(
        { error: "ticketLineId, supplierId, sourceType, and costUnit are required" },
        { status: 400 }
      );
    }

    const option = await prisma.supplierOption.create({
      data: {
        ticketLineId,
        supplierId,
        sourceType,
        costUnit,
        qtyAvailable,
        leadTimeDays,
        isPreferred,
        notes,
      },
      include: {
        supplier: true,
        ticketLine: true,
      },
    });

    return Response.json(option, { status: 201 });
  } catch (error) {
    console.error("Failed to create supplier option:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create supplier option" }, { status: 500 });
  }
}

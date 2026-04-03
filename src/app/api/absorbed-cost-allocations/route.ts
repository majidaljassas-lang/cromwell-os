import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");

    const where: Record<string, string> = {};
    if (ticketId) where.ticketId = ticketId;

    const allocations = await prisma.absorbedCostAllocation.findMany({
      where,
      include: {
        supplierBillLine: {
          include: {
            supplierBill: true,
          },
        },
        ticket: true,
        ticketLine: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(allocations);
  } catch (error) {
    console.error("Failed to list absorbed cost allocations:", error);
    return Response.json(
      { error: "Failed to list absorbed cost allocations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      supplierBillLineId,
      ticketId,
      ticketLineId,
      description,
      amount,
      allocationBasis,
    } = body;

    if (!supplierBillLineId || !ticketId || !description || amount === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: supplierBillLineId, ticketId, description, amount",
        },
        { status: 400 }
      );
    }

    const allocation = await prisma.$transaction(async (tx) => {
      const created = await tx.absorbedCostAllocation.create({
        data: {
          supplierBillLineId,
          ticketId,
          ticketLineId,
          description,
          amount,
          allocationBasis,
        },
        include: {
          supplierBillLine: {
            include: {
              supplierBill: true,
            },
          },
          ticket: true,
          ticketLine: true,
        },
      });

      // Update the supplier bill line's cost classification to ABSORBED
      await tx.supplierBillLine.update({
        where: { id: supplierBillLineId },
        data: {
          costClassification: "ABSORBED",
        },
      });

      return created;
    });

    return Response.json(allocation, { status: 201 });
  } catch (error) {
    console.error("Failed to create absorbed cost allocation:", error);
    return Response.json(
      { error: "Failed to create absorbed cost allocation" },
      { status: 500 }
    );
  }
}

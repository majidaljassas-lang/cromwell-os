import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const ticketId = searchParams.get("ticketId");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (ticketId) {
      where.ticketLine = { ticketId };
    }
    if (status) {
      where.allocationStatus = status;
    }

    const allocations = await prisma.costAllocation.findMany({
      where,
      include: {
        ticketLine: true,
        supplierBillLine: {
          include: {
            supplierBill: true,
          },
        },
        supplier: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(allocations);
  } catch (error) {
    console.error("Failed to list cost allocations:", error);
    return Response.json(
      { error: "Failed to list cost allocations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      ticketLineId,
      supplierBillLineId,
      supplierId,
      qtyAllocated,
      unitCost,
      totalCost,
      allocationStatus = "MATCHED",
      confidenceScore,
      notes,
    } = body;

    if (
      !ticketLineId ||
      !supplierBillLineId ||
      !supplierId ||
      qtyAllocated === undefined ||
      unitCost === undefined ||
      totalCost === undefined
    ) {
      return Response.json(
        {
          error:
            "Missing required fields: ticketLineId, supplierBillLineId, supplierId, qtyAllocated, unitCost, totalCost",
        },
        { status: 400 }
      );
    }

    const allocation = await prisma.$transaction(async (tx) => {
      const created = await tx.costAllocation.create({
        data: {
          ticketLineId,
          supplierBillLineId,
          supplierId,
          qtyAllocated,
          unitCost,
          totalCost,
          allocationStatus,
          confidenceScore,
          notes,
        },
        include: {
          ticketLine: true,
          supplierBillLine: {
            include: {
              supplierBill: true,
            },
          },
          supplier: true,
        },
      });

      // Update the supplier bill line's allocation status
      await tx.supplierBillLine.update({
        where: { id: supplierBillLineId },
        data: {
          allocationStatus:
            allocationStatus === "MATCHED" ? "MATCHED" : "PARTIAL",
        },
      });

      return created;
    });

    await logAudit({
      objectType: "CostAllocation",
      objectId: allocation.id,
      actionType: "MANUAL_ALLOCATION",
      newValue: { ticketLineId, supplierBillLineId, totalCost, allocationStatus },
    });

    return Response.json(allocation, { status: 201 });
  } catch (error) {
    console.error("Failed to create cost allocation:", error);
    return Response.json(
      { error: "Failed to create cost allocation" },
      { status: 500 }
    );
  }
}

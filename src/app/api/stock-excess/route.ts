import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const records = await prisma.stockExcessRecord.findMany({
      include: {
        supplierBillLine: true,
        ticketLine: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(records);
  } catch (error) {
    console.error("Failed to list stock excess records:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list stock excess records" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      supplierBillLineId,
      ticketLineId,
      purchasedCost,
      usedCost,
      excessCost,
      treatment,
      status = "OPEN",
    } = body;

    if (
      !supplierBillLineId ||
      purchasedCost === undefined ||
      usedCost === undefined ||
      excessCost === undefined ||
      !treatment
    ) {
      return Response.json(
        {
          error:
            "Missing required fields: supplierBillLineId, purchasedCost, usedCost, excessCost, treatment",
        },
        { status: 400 }
      );
    }

    const validTreatments = ["HOLD", "REALLOCATE", "WRITE_OFF"];
    if (!validTreatments.includes(treatment)) {
      return Response.json(
        {
          error: `Invalid treatment value. Must be one of: ${validTreatments.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const record = await prisma.stockExcessRecord.create({
      data: {
        supplierBillLineId,
        ticketLineId,
        purchasedCost,
        usedCost,
        excessCost,
        treatment,
        status,
      },
      include: {
        supplierBillLine: true,
        ticketLine: true,
      },
    });

    return Response.json(record, { status: 201 });
  } catch (error) {
    console.error("Failed to create stock excess record:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create stock excess record" },
      { status: 500 }
    );
  }
}

import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const bill = await prisma.supplierBill.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!bill) {
      return Response.json({ error: "Supplier bill not found" }, { status: 404 });
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description) {
      return Response.json({ error: "description is required" }, { status: 400 });
    }

    const qty = Number(body.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return Response.json({ error: "qty must be a positive number" }, { status: 400 });
    }

    const unitCost = Number(body.unitCost);
    if (!Number.isFinite(unitCost)) {
      return Response.json({ error: "unitCost must be a number" }, { status: 400 });
    }

    const lineTotal = Number((qty * unitCost).toFixed(2));

    // Default GL bucket: 5000 Materials. Nullable if not seeded.
    const gl = await prisma.chartOfAccount.findFirst({
      where: { accountCode: "5000" },
      select: { id: true },
    });

    const line = await prisma.supplierBillLine.create({
      data: {
        supplierBillId: id,
        description,
        qty,
        unitCost,
        lineTotal,
        costClassification: "BILLABLE",
        allocationStatus: "UNALLOCATED",
        vatRate: 20,
        vatStatus: "STANDARD",
        glAccountId: gl?.id ?? null,
      },
    });

    return Response.json(line, { status: 201 });
  } catch (error) {
    console.error("Failed to create bill line:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create line" },
      { status: 500 }
    );
  }
}

import { prisma } from "@/lib/prisma";
import { processBill } from "@/lib/finance/bill-processor";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Verify bill exists
    const bill = await prisma.supplierBill.findUnique({
      where: { id },
      select: { id: true, billNo: true },
    });

    if (!bill) {
      return Response.json(
        { error: "Supplier bill not found" },
        { status: 404 }
      );
    }

    const result = await processBill(id);

    // Re-fetch the bill with updated statuses
    const updatedBill = await prisma.supplierBill.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: {
          include: {
            site: true,
            customer: true,
            ticket: true,
            costAllocations: true,
          },
        },
      },
    });

    return Response.json({ bill: updatedBill, processing: result });
  } catch (error) {
    console.error("Failed to process supplier bill:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process supplier bill",
      },
      { status: 500 }
    );
  }
}

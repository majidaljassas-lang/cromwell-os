import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      "benchmarkUnit",
      "expectedCostUnit",
      "suggestedSaleUnit",
      "actualSaleUnit",
      "expectedMarginUnit",
      "notes",
      "supplierSourceSummary",
    ];

    const data: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) {
        data[field] = body[field];
      }
    }

    const snapshot = await prisma.dealSheetLineSnapshot.update({
      where: { id },
      data,
    });

    return Response.json(snapshot);
  } catch (error) {
    console.error("Failed to update deal sheet line snapshot:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update deal sheet line snapshot" }, { status: 500 });
  }
}

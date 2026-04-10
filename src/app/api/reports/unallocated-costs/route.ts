import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const unallocatedLines = await prisma.supplierBillLine.findMany({
      where: { allocationStatus: "UNALLOCATED" },
      include: {
        supplierBill: {
          include: {
            supplier: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(unallocatedLines);
  } catch (error) {
    console.error("Failed to list unallocated costs:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list unallocated costs" },
      { status: 500 }
    );
  }
}

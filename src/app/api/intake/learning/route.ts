/**
 * GET /api/intake/learning — recent BillIntakeCorrection rows, grouped by correctionType.
 * Surfaces what the engine has learned from user actions (rejections, reassignments, surplus routings).
 */
import { prisma } from "@/lib/prisma";

export async function GET() {
  const recent = await prisma.billIntakeCorrection.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      supplierBillLine: {
        select: {
          description: true,
          supplierBill: { select: { billNo: true, supplier: { select: { name: true } } } },
        },
      },
    },
  });

  // Counts by correctionType
  const grouped = await prisma.billIntakeCorrection.groupBy({
    by: ["correctionType"],
    _count: { _all: true },
  });

  return Response.json({
    counts: Object.fromEntries(grouped.map((g) => [g.correctionType, g._count._all])),
    total: recent.length,
    recent: recent.map((r) => ({
      id: r.id,
      correctionType: r.correctionType,
      createdAt: r.createdAt,
      before: r.beforeJson,
      after: r.afterJson,
      billNo: r.supplierBillLine?.supplierBill?.billNo ?? null,
      supplier: r.supplierBillLine?.supplierBill?.supplier?.name ?? null,
      lineDescription: r.supplierBillLine?.description ?? null,
    })),
  });
}

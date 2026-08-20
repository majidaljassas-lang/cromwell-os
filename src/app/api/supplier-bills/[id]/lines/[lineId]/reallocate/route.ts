import { prisma } from "@/lib/prisma";
import { allocateBillLine } from "@/lib/intake/allocation-engine";

/**
 * Re-run the allocation engine for a single bill line. Wipes unposted
 * BillLineAllocation rows and recomputes from scratch.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await params;

  const line = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    select: { supplierBillId: true },
  });
  if (!line || line.supplierBillId !== id) {
    return Response.json({ error: "Bill line not found on this bill" }, { status: 404 });
  }

  const result = await allocateBillLine(lineId);

  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: {
        include: { site: true, customer: true, ticket: true, costAllocations: true },
      },
    },
  });

  return Response.json({ bill, result });
}

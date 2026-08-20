import { prisma } from "@/lib/prisma";
import { allocateBillLine } from "@/lib/intake/allocation-engine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await params;
  const body = await request.json();
  const splitQty = Number(body.qty);
  const reason = typeof body.reason === "string" ? body.reason : null;

  if (!Number.isFinite(splitQty) || splitQty <= 0) {
    return Response.json({ error: "qty must be a positive number" }, { status: 400 });
  }

  const parent = await prisma.supplierBillLine.findUnique({ where: { id: lineId } });
  if (!parent || parent.supplierBillId !== id) {
    return Response.json({ error: "Bill line not found on this bill" }, { status: 404 });
  }

  const parentQty = Number(parent.qty);
  if (splitQty >= parentQty) {
    return Response.json(
      { error: `split qty (${splitQty}) must be less than line qty (${parentQty})` },
      { status: 400 }
    );
  }

  const unitCost = Number(parent.unitCost);
  const newQty = parentQty - splitQty;
  const newParentTotal = Math.round(newQty * unitCost * 100) / 100;
  const childTotal = Math.round(splitQty * unitCost * 100) / 100;

  const childId = await prisma.$transaction(async (tx) => {
    // Wipe unposted allocations on the parent so the engine reruns cleanly.
    await tx.billLineAllocation.deleteMany({
      where: {
        supplierBillLineId: lineId,
        costAllocationId: null,
        returnId: null,
        stockExcessRecordId: null,
        absorbedAllocationId: null,
      },
    });

    await tx.supplierBillLine.update({
      where: { id: lineId },
      data: {
        qty:              newQty,
        lineTotal:        newParentTotal,
        allocationStatus: "UNALLOCATED",
      },
    });

    const child = await tx.supplierBillLine.create({
      data: {
        supplierBillId:     parent.supplierBillId,
        description:        reason ? `${parent.description} (split: ${reason})` : parent.description,
        normalizedItemName: parent.normalizedItemName,
        productCode:        parent.productCode,
        qty:                splitQty,
        unitCost,
        lineTotal:          childTotal,
        costClassification: parent.costClassification,
        allocationStatus:   "UNALLOCATED",
        vatRate:            parent.vatRate,
        originalUom:        parent.originalUom,
        packSize:           parent.packSize,
        extractedSku:       parent.extractedSku,
        intakeDocumentId:   parent.intakeDocumentId,
      },
    });

    return child.id;
  });

  // Re-run allocation engine on both pieces.
  await Promise.all([allocateBillLine(lineId), allocateBillLine(childId)]);

  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: {
        include: { site: true, customer: true, ticket: true, costAllocations: true },
      },
    },
  });

  return Response.json({ bill, parentLineId: lineId, childLineId: childId });
}

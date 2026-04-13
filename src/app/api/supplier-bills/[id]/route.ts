import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bill = await prisma.supplierBill.findUnique({
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

    if (!bill) {
      return Response.json(
        { error: "Supplier bill not found" },
        { status: 404 }
      );
    }

    return Response.json(bill);
  } catch (error) {
    console.error("Failed to fetch supplier bill:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch supplier bill" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.supplierBill.findUnique({
      where: { id },
    });

    if (!existing) {
      return Response.json(
        { error: "Supplier bill not found" },
        { status: 404 }
      );
    }

    const { status, siteRef, customerRef, totalCost, sourceAttachmentRef } = body;

    const updated = await prisma.supplierBill.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(siteRef !== undefined && { siteRef }),
        ...(customerRef !== undefined && { customerRef }),
        ...(totalCost !== undefined && { totalCost }),
        ...(sourceAttachmentRef !== undefined && { sourceAttachmentRef }),
      },
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

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update supplier bill:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update supplier bill" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Get line IDs for cleanup
    const lineIds = (await prisma.supplierBillLine.findMany({
      where: { supplierBillId: id },
      select: { id: true },
    })).map(l => l.id);

    if (lineIds.length > 0) {
      // Clean up cost allocations and absorbed costs linked to these bill lines
      await prisma.costAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
      await prisma.absorbedCostAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
      await prisma.creditNoteAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } }).catch(() => {});
    }

    // Delete lines then bill
    await prisma.supplierBillLine.deleteMany({ where: { supplierBillId: id } });
    await prisma.supplierBill.delete({ where: { id } });

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete supplier bill:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete" }, { status: 500 });
  }
}

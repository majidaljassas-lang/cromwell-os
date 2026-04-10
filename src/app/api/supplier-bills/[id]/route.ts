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

import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const procurementOrder = await prisma.procurementOrder.findUnique({
      where: { id },
      include: {
        supplier: true,
        lines: {
          include: {
            ticketLine: true,
            supplierOption: true,
          },
        },
        ticket: true,
      },
    });

    if (!procurementOrder) {
      return Response.json(
        { error: "Procurement order not found" },
        { status: 404 }
      );
    }

    return Response.json(procurementOrder);
  } catch (error) {
    console.error("Failed to fetch procurement order:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch procurement order" },
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

    const existing = await prisma.procurementOrder.findUnique({
      where: { id },
    });

    if (!existing) {
      return Response.json(
        { error: "Procurement order not found" },
        { status: 404 }
      );
    }

    const { poNo, status, supplierId, supplierRef, deliveryDateExpected, siteRef, totalCostExpected } = body;

    const updated = await prisma.procurementOrder.update({
      where: { id },
      data: {
        ...(poNo !== undefined && { poNo }),
        ...(status !== undefined && { status }),
        ...(supplierId !== undefined && { supplierId }),
        ...(supplierRef !== undefined && { supplierRef }),
        ...(deliveryDateExpected !== undefined && {
          deliveryDateExpected: deliveryDateExpected
            ? new Date(deliveryDateExpected)
            : null,
        }),
        ...(siteRef !== undefined && { siteRef }),
        ...(totalCostExpected !== undefined && { totalCostExpected }),
      },
      include: {
        supplier: true,
        lines: {
          include: {
            ticketLine: true,
            supplierOption: true,
          },
        },
        ticket: true,
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update procurement order:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update procurement order" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Delete lines first, then the order
    await prisma.procurementOrderLine.deleteMany({ where: { procurementOrderId: id } });
    await prisma.procurementOrder.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete procurement order:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete procurement order" }, { status: 500 });
  }
}

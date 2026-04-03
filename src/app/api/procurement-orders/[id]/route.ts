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
      { error: "Failed to fetch procurement order" },
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

    const { status, supplierRef, deliveryDateExpected, siteRef, totalCostExpected } = body;

    const updated = await prisma.procurementOrder.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
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
      { error: "Failed to update procurement order" },
      { status: 500 }
    );
  }
}

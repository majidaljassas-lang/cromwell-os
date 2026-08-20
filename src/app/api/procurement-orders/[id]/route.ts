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

    const {
      poNo,
      status,
      supplierId,
      supplierRef,
      deliveryDateExpected,
      siteRef,
      siteContact,
      totalCostExpected,
      lines,
    } = body;

    const updated = await prisma.$transaction(async (tx) => {
      // If lines array provided, replace all lines + recompute total
      let computedTotal: number | undefined;
      if (Array.isArray(lines)) {
        await tx.procurementOrderLine.deleteMany({ where: { procurementOrderId: id } });
        if (lines.length > 0) {
          await tx.procurementOrderLine.createMany({
            data: lines.map(
              (line: {
                ticketLineId: string;
                supplierOptionId?: string;
                description: string;
                qty: number;
                unitCost: number;
                lineTotal: number;
              }) => ({
                procurementOrderId: id,
                ticketLineId: line.ticketLineId,
                supplierOptionId: line.supplierOptionId,
                description: line.description,
                qty: line.qty,
                unitCost: line.unitCost,
                lineTotal: line.lineTotal,
              }),
            ),
          });
        }
        computedTotal = lines.reduce(
          (s: number, l: { lineTotal: number }) => s + Number(l.lineTotal || 0),
          0,
        );
      }

      return tx.procurementOrder.update({
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
          ...(siteContact !== undefined && { siteContact }),
          ...(totalCostExpected !== undefined
            ? { totalCostExpected }
            : computedTotal !== undefined
              ? { totalCostExpected: computedTotal }
              : {}),
        },
        include: {
          supplier: true,
          lines: { include: { ticketLine: true, supplierOption: true } },
          ticket: true,
        },
      });
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

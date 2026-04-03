import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const procurementOrders = await prisma.procurementOrder.findMany({
      where: { ticketId: id },
      include: {
        supplier: true,
        lines: {
          include: {
            ticketLine: true,
          },
        },
      },
      orderBy: { issuedAt: "desc" },
    });

    return Response.json(procurementOrders);
  } catch (error) {
    console.error("Failed to list procurement orders:", error);
    return Response.json(
      { error: "Failed to list procurement orders" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      supplierId,
      poNo,
      supplierRef,
      issuedAt,
      status = "DRAFT",
      siteRef,
      deliveryDateExpected,
      totalCostExpected,
      lines,
    } = body;

    if (!supplierId || !poNo) {
      return Response.json(
        { error: "Missing required fields: supplierId, poNo" },
        { status: 400 }
      );
    }

    const procurementOrder = await prisma.$transaction(async (tx) => {
      const po = await tx.procurementOrder.create({
        data: {
          ticketId: id,
          supplierId,
          poNo,
          supplierRef,
          issuedAt: issuedAt ? new Date(issuedAt) : undefined,
          status,
          siteRef,
          deliveryDateExpected: deliveryDateExpected
            ? new Date(deliveryDateExpected)
            : undefined,
          totalCostExpected: totalCostExpected ?? 0,
        },
      });

      if (lines && Array.isArray(lines) && lines.length > 0) {
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
              procurementOrderId: po.id,
              ticketLineId: line.ticketLineId,
              supplierOptionId: line.supplierOptionId,
              description: line.description,
              qty: line.qty,
              unitCost: line.unitCost,
              lineTotal: line.lineTotal,
            })
          ),
        });
      }

      return tx.procurementOrder.findUnique({
        where: { id: po.id },
        include: {
          supplier: true,
          lines: {
            include: {
              ticketLine: true,
            },
          },
        },
      });
    });

    return Response.json(procurementOrder, { status: 201 });
  } catch (error) {
    console.error("Failed to create procurement order:", error);
    return Response.json(
      { error: "Failed to create procurement order" },
      { status: 500 }
    );
  }
}

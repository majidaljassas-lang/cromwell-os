import { prisma } from "@/lib/prisma";
import { calculateClosureStatus } from "@/lib/commercial/reconciliation-engine";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const group = await prisma.orderGroup.findUnique({
      where: { id },
      include: {
        site: true,
        orderEvents: {
          include: { canonicalProduct: true },
          orderBy: { timestamp: "asc" },
        },
        supplyEvents: {
          include: { canonicalProduct: true },
          orderBy: { timestamp: "asc" },
        },
        invoiceLineAllocations: {
          include: {
            commercialInvoiceLine: {
              include: { commercialInvoice: true },
            },
          },
        },
      },
    });

    if (!group) {
      return Response.json({ error: "Order group not found" }, { status: 404 });
    }

    return Response.json(group);
  } catch (error) {
    console.error("Failed to get order group:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to get order group" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // If requesting closure recalculation
    if (body.recalculateClosure) {
      const closureStatus = await calculateClosureStatus(id);
      const updated = await prisma.orderGroup.update({
        where: { id },
        data: { closureStatus: closureStatus as any },
      });
      return Response.json(updated);
    }

    const { label, description, fulfilmentStatus, billingStatus, closureStatus } = body;
    const data: Record<string, unknown> = {};
    if (label !== undefined) data.label = label;
    if (description !== undefined) data.description = description;
    if (fulfilmentStatus !== undefined) data.fulfilmentStatus = fulfilmentStatus;
    if (billingStatus !== undefined) data.billingStatus = billingStatus;
    if (closureStatus !== undefined) data.closureStatus = closureStatus;

    const updated = await prisma.orderGroup.update({
      where: { id },
      data,
    });
    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update order group:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update order group" }, { status: 500 });
  }
}

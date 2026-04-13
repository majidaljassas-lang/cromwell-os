import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        options: true,
        procurementOrders: true,
        supplierBills: true,
      },
    });

    if (!supplier) {
      return Response.json({ error: "Supplier not found" }, { status: 404 });
    }

    return Response.json(supplier);
  } catch (error) {
    console.error("Failed to fetch supplier:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch supplier" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const supplier = await prisma.supplier.update({
      where: { id },
      data: body,
    });

    return Response.json(supplier);
  } catch (error) {
    console.error("Failed to update supplier:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update supplier" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Check for linked records
    const bills = await prisma.supplierBill.count({ where: { supplierId: id } });
    const orders = await prisma.procurementOrder.count({ where: { supplierId: id } });

    if (bills > 0 || orders > 0) {
      return Response.json({
        error: `Cannot delete — supplier has ${bills} bill(s) and ${orders} order(s). Remove those first.`,
      }, { status: 409 });
    }

    // Clean up ticket line references
    await prisma.ticketLine.updateMany({
      where: { supplierId: id },
      data: { supplierId: null, supplierName: null },
    });

    // Clean up supplier options
    await prisma.supplierOption.deleteMany({ where: { supplierId: id } });

    await prisma.supplier.delete({ where: { id } });
    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete supplier:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete supplier" }, { status: 500 });
  }
}

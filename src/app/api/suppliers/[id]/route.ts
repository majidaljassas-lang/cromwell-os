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
    return Response.json({ error: "Failed to fetch supplier" }, { status: 500 });
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
    return Response.json({ error: "Failed to update supplier" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { siteCommercialLinks: true },
    });
    if (!customer) {
      return Response.json({ error: "Customer not found" }, { status: 404 });
    }
    return Response.json(customer);
  } catch (error) {
    console.error("Failed to get customer:", error);
    return Response.json(
      { error: "Failed to get customer" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const customer = await prisma.customer.update({
      where: { id },
      data: body,
    });
    return Response.json(customer);
  } catch (error) {
    console.error("Failed to update customer:", error);
    return Response.json(
      { error: "Failed to update customer" },
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
    // Remove dependent records first
    await prisma.customerAlias.deleteMany({ where: { customerId: id } });
    await prisma.siteCommercialLink.deleteMany({ where: { customerId: id } });
    await prisma.customer.updateMany({ where: { parentCustomerEntityId: id }, data: { parentCustomerEntityId: null } });

    await prisma.customer.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete customer:", error);
    return Response.json(
      { error: "Failed to delete customer" },
      { status: 500 }
    );
  }
}

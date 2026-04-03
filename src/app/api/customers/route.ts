import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: "desc" },
    });
    return Response.json(customers);
  } catch (error) {
    console.error("Failed to list customers:", error);
    return Response.json(
      { error: "Failed to list customers" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const customer = await prisma.customer.create({ data: body });
    return Response.json(customer, { status: 201 });
  } catch (error) {
    console.error("Failed to create customer:", error);
    return Response.json(
      { error: "Failed to create customer" },
      { status: 500 }
    );
  }
}

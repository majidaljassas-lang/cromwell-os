import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");

    const where = search
      ? { OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { legalName: { contains: search, mode: "insensitive" as const } },
        ] }
      : {};

    const customers = await prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
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

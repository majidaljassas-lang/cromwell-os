import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    return Response.json(suppliers);
  } catch (error) {
    console.error("Failed to fetch suppliers:", error);
    return Response.json({ error: "Failed to fetch suppliers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, legalName, email, phone, notes } = body;

    if (!name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    const supplier = await prisma.supplier.create({
      data: { name, legalName, email, phone, notes },
    });

    return Response.json(supplier, { status: 201 });
  } catch (error) {
    console.error("Failed to create supplier:", error);
    return Response.json({ error: "Failed to create supplier" }, { status: 500 });
  }
}

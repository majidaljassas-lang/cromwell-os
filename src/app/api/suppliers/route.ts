import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const suppliers = await prisma.supplier.findMany({
      orderBy: { name: "asc" },
    });
    return Response.json(suppliers);
  } catch (error) {
    console.error("Failed to fetch suppliers:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch suppliers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, legalName, email, phone, notes } = body;

    if (!name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    // Prevent duplicates (case-insensitive)
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: name.trim(), mode: "insensitive" } },
    });
    if (existing) {
      return Response.json({ error: `Supplier "${existing.name}" already exists` }, { status: 409 });
    }

    const supplier = await prisma.supplier.create({
      data: { name: name.trim(), legalName, email, phone, notes },
    });

    return Response.json(supplier, { status: 201 });
  } catch (error) {
    console.error("Failed to create supplier:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create supplier" }, { status: 500 });
  }
}

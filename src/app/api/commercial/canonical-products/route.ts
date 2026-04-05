import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const products = await prisma.canonicalProduct.findMany({
      where: { isActive: true },
      include: {
        substitutionMemberships: {
          include: { family: true },
        },
        uomConversions: true,
      },
      orderBy: { code: "asc" },
    });
    return Response.json(products);
  } catch (error) {
    console.error("Failed to list canonical products:", error);
    return Response.json({ error: "Failed to list canonical products" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { code, name, category, canonicalUom, aliases } = body;

    if (!code || !name || !canonicalUom) {
      return Response.json({ error: "code, name, and canonicalUom are required" }, { status: 400 });
    }

    const product = await prisma.canonicalProduct.create({
      data: { code, name, category, canonicalUom, aliases: aliases || [] },
    });
    return Response.json(product, { status: 201 });
  } catch (error) {
    console.error("Failed to create canonical product:", error);
    return Response.json({ error: "Failed to create canonical product" }, { status: 500 });
  }
}

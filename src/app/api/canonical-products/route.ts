import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, code, canonicalUom } = body;

    if (!name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    const product = await prisma.canonicalProduct.create({
      data: {
        name,
        code: code || `CP-${Date.now()}`,
        canonicalUom: canonicalUom || "EA",
      },
    });

    return Response.json(product, { status: 201 });
  } catch (error) {
    console.error("Failed to create canonical product:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create" },
      { status: 500 }
    );
  }
}

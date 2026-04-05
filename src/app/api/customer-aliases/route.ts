import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId");

    const where = customerId ? { customerId } : {};

    const aliases = await prisma.customerAlias.findMany({
      where,
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { aliasText: "asc" },
    });

    return Response.json(aliases);
  } catch (error) {
    console.error("Failed to fetch customer aliases:", error);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerId, aliasText, sourceType } = body;

    if (!customerId || !aliasText) {
      return Response.json({ error: "customerId and aliasText required" }, { status: 400 });
    }

    const alias = await prisma.customerAlias.create({
      data: {
        customerId,
        aliasText: aliasText.toLowerCase().trim(),
        sourceType,
        aliasSource: "manual",
        manualConfirmed: true,
        confidenceScore: 100,
      },
      include: { customer: { select: { id: true, name: true } } },
    });

    return Response.json(alias, { status: 201 });
  } catch (error) {
    console.error("Failed to create customer alias:", error);
    return Response.json({ error: "Failed to create" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return Response.json({ error: "id required" }, { status: 400 });
    }

    await prisma.customerAlias.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete customer alias:", error);
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}

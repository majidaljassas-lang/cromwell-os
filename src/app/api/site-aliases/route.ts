import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    const where = siteId ? { siteId } : {};

    const aliases = await prisma.siteAlias.findMany({
      where,
      include: { site: { select: { id: true, siteName: true } } },
      orderBy: { aliasText: "asc" },
    });

    return Response.json(aliases);
  } catch (error) {
    console.error("Failed to fetch site aliases:", error);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId, aliasText, sourceType, confidenceDefault } = body;

    if (!siteId || !aliasText) {
      return Response.json({ error: "siteId and aliasText required" }, { status: 400 });
    }

    const alias = await prisma.siteAlias.create({
      data: {
        siteId,
        aliasText: aliasText.toLowerCase().trim(),
        sourceType,
        confidenceDefault: confidenceDefault ?? 90,
      },
      include: { site: { select: { id: true, siteName: true } } },
    });

    return Response.json(alias, { status: 201 });
  } catch (error) {
    console.error("Failed to create site alias:", error);
    return Response.json({ error: "Failed to create" }, { status: 500 });
  }
}

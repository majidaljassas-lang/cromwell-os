import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search");

    const where = search
      ? { OR: [
          { siteName: { contains: search, mode: "insensitive" as const } },
          { siteCode: { contains: search, mode: "insensitive" as const } },
          { city: { contains: search, mode: "insensitive" as const } },
          { postcode: { contains: search, mode: "insensitive" as const } },
        ] }
      : {};

    const sites = await prisma.site.findMany({
      where,
      include: { siteCommercialLinks: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return Response.json(sites);
  } catch (error) {
    console.error("Failed to list sites:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to list sites" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const site = await prisma.site.create({ data: body });
    return Response.json(site, { status: 201 });
  } catch (error) {
    console.error("Failed to create site:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create site" }, { status: 500 });
  }
}

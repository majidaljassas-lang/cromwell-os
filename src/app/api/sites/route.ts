import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const sites = await prisma.site.findMany({
      include: { siteCommercialLinks: true },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(sites);
  } catch (error) {
    console.error("Failed to list sites:", error);
    return Response.json({ error: "Failed to list sites" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const site = await prisma.site.create({ data: body });
    return Response.json(site, { status: 201 });
  } catch (error) {
    console.error("Failed to create site:", error);
    return Response.json({ error: "Failed to create site" }, { status: 500 });
  }
}

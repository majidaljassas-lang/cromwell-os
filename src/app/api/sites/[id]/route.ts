import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const site = await prisma.site.findUnique({
      where: { id },
      include: {
        siteCommercialLinks: true,
        siteContactLinks: true,
        tickets: true,
      },
    });
    if (!site) {
      return Response.json({ error: "Site not found" }, { status: 404 });
    }
    return Response.json(site);
  } catch (error) {
    console.error("Failed to get site:", error);
    return Response.json({ error: "Failed to get site" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const f of ["siteName", "siteCode", "addressLine1", "addressLine2", "city", "postcode", "country", "notes", "aliases", "isActive"]) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }
    const site = await prisma.site.update({
      where: { id },
      data: allowed,
    });
    return Response.json(site);
  } catch (error) {
    console.error("Failed to update site:", error);
    return Response.json({ error: "Failed to update site" }, { status: 500 });
  }
}

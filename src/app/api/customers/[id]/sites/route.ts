import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const links = await prisma.siteCommercialLink.findMany({
      where: { customerId: id, isActive: true },
      include: {
        site: {
          select: {
            id: true,
            siteName: true,
            siteCode: true,
            city: true,
            postcode: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Dedupe — same site can be linked under multiple roles to one customer.
    const seen = new Set<string>();
    const sites = [] as Array<{ id: string; siteName: string; siteCode: string | null; city: string | null; postcode: string | null }>;
    for (const link of links) {
      if (!link.site) continue;
      if (seen.has(link.site.id)) continue;
      seen.add(link.site.id);
      sites.push(link.site);
    }

    return Response.json(sites);
  } catch (error) {
    console.error("Failed to list sites for customer:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list sites" },
      { status: 500 }
    );
  }
}

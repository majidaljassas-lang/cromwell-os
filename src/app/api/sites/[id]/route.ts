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
    return Response.json({ error: error instanceof Error ? error.message : "Failed to get site" }, { status: 500 });
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
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update site" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [ticketCount, commercialLinkCount, labourDrawdownCount] = await Promise.all([
      prisma.ticket.count({ where: { siteId: id } }),
      prisma.siteCommercialLink.count({ where: { siteId: id } }),
      prisma.labourDrawdownEntry.count({ where: { siteId: id } }),
    ]);

    if (ticketCount > 0 || commercialLinkCount > 0 || labourDrawdownCount > 0) {
      const parts: string[] = [];
      if (ticketCount > 0) parts.push(`${ticketCount} ticket${ticketCount === 1 ? "" : "s"}`);
      if (commercialLinkCount > 0) parts.push(`${commercialLinkCount} commercial link${commercialLinkCount === 1 ? "" : "s"}`);
      if (labourDrawdownCount > 0) parts.push(`${labourDrawdownCount} labour drawdown entr${labourDrawdownCount === 1 ? "y" : "ies"}`);
      return Response.json(
        { error: `Cannot delete: site has ${parts.join(", ")}.` },
        { status: 409 }
      );
    }

    await prisma.site.delete({ where: { id } });
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete site:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete site" },
      { status: 500 }
    );
  }
}

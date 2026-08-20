import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const { id: siteId, linkId } = await params;
  try {
    const body = await request.json();

    const existing = await prisma.siteCommercialLink.findUnique({
      where: { id: linkId },
      select: { siteId: true },
    });
    if (!existing || existing.siteId !== siteId) {
      return Response.json({ error: "Commercial link not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if ("commercialNotes" in body) {
      const v =
        typeof body.commercialNotes === "string"
          ? body.commercialNotes.trim()
          : "";
      data.commercialNotes = v || null;
    }

    const link = await prisma.siteCommercialLink.update({
      where: { id: linkId },
      data,
    });
    return Response.json(link);
  } catch (error) {
    console.error("Failed to update commercial link:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update commercial link" },
      { status: 500 }
    );
  }
}

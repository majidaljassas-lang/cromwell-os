import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const event = await prisma.ingestionEvent.findUnique({
      where: { id },
      include: {
        source: true,
        parsedMessages: {
          include: {
            extractedEntities: true,
            ingestionLinks: {
              include: {
                enquiry: { select: { id: true, subjectOrLabel: true, status: true } },
                ticket: { select: { id: true, title: true, status: true } },
                evidenceFragment: { select: { id: true, fragmentType: true } },
                supplierBill: { select: { id: true, billNo: true } },
                supplierBillLine: { select: { id: true, description: true } },
                event: { select: { id: true, eventType: true } },
              },
            },
          },
        },
        sourceSiteMatches: {
          include: { matchedSite: { select: { id: true, siteName: true } } },
        },
      },
    });

    if (!event) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    return Response.json(event);
  } catch (error) {
    console.error("Failed to fetch ingestion event:", error);
    return Response.json({ error: "Failed to fetch event" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const eventKind = searchParams.get("eventKind");
    const sourceId = searchParams.get("sourceId");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (eventKind) where.eventKind = eventKind;
    if (sourceId) where.sourceId = sourceId;

    const [events, total] = await Promise.all([
      prisma.ingestionEvent.findMany({
        where,
        include: {
          source: { select: { sourceType: true, accountName: true } },
          parsedMessages: {
            select: { id: true, messageType: true, confidenceScore: true },
          },
          _count: { select: { parsedMessages: true } },
        },
        orderBy: { receivedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.ingestionEvent.count({ where }),
    ]);

    return Response.json({ events, total, limit, offset });
  } catch (error) {
    console.error("Failed to fetch ingestion events:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch events" }, { status: 500 });
  }
}

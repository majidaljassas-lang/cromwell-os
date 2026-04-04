import { prisma } from "@/lib/prisma";

/**
 * Unified timeline — NEVER truncates silently.
 * Pagination: limit + offset. Default limit=100.
 * Always returns: totalCount, returnedCount, hasMore.
 * Order: parsedTimestamp ASC always.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const messageType = searchParams.get("messageType");
    const sender = searchParams.get("sender");
    const sourceFilter = searchParams.get("sourceId");
    const parsedOk = searchParams.get("parsedOk");
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const offset = parseInt(searchParams.get("offset") || "0");

    const sources = await prisma.backlogSource.findMany({
      where: { group: { caseId } },
      select: { id: true, label: true, sourceType: true },
    });
    const sourceIds = sources.map((s) => s.id);
    const sourceMap: Record<string, { label: string; sourceType: string }> = {};
    for (const s of sources) sourceMap[s.id] = { label: s.label, sourceType: s.sourceType };

    if (sourceIds.length === 0) {
      return Response.json({ messages: [], totalCount: 0, returnedCount: 0, hasMore: false, stats: {} });
    }

    const where: Record<string, unknown> = {
      sourceId: sourceFilter || { in: sourceIds },
    };
    if (messageType && messageType !== "ALL") where.messageType = messageType;
    if (sender) where.sender = { contains: sender, mode: "insensitive" };
    if (parsedOk === "true") where.parsedOk = true;
    if (parsedOk === "false") where.parsedOk = false;

    const totalCount = await prisma.backlogMessage.count({ where });

    const messages = await prisma.backlogMessage.findMany({
      where,
      orderBy: { parsedTimestamp: "asc" },
      take: limit,
      skip: offset,
    });

    const returnedCount = messages.length;
    const hasMore = offset + returnedCount < totalCount;

    const enriched = messages.map((m) => ({
      ...m,
      sourceLabel: sourceMap[m.sourceId]?.label || "Unknown",
      sourceType: sourceMap[m.sourceId]?.sourceType || "Unknown",
    }));

    // Stats from ALL messages (not just page)
    const stats = await prisma.backlogMessage.aggregate({
      where: { sourceId: { in: sourceIds } },
      _count: true,
      _min: { parsedTimestamp: true },
      _max: { parsedTimestamp: true },
    });

    const participantsRaw = await prisma.backlogMessage.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { sender: true },
      distinct: ["sender"],
    });

    const mediaCount = await prisma.backlogMessage.count({
      where: { sourceId: { in: sourceIds }, hasMedia: true },
    });

    return Response.json({
      messages: enriched,
      totalCount,
      returnedCount,
      hasMore,
      limit,
      offset,
      stats: {
        dbTotal: stats._count,
        participants: participantsRaw.map((p) => p.sender),
        participantCount: participantsRaw.length,
        mediaCount,
        dateFrom: stats._min.parsedTimestamp,
        dateTo: stats._max.parsedTimestamp,
      },
    });
  } catch (error) {
    console.error("Timeline failed:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

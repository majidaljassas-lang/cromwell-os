import { prisma } from "@/lib/prisma";

/**
 * Unified timeline — merge ALL messages across ALL sources for this case.
 * Sorted by timestamp. No grouping. No collapsing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const messageType = searchParams.get("messageType");
    const sender = searchParams.get("sender");
    const limit = parseInt(searchParams.get("limit") || "500");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Get all source IDs for this case
    const sources = await prisma.backlogSource.findMany({
      where: { group: { caseId } },
      select: { id: true, label: true, sourceType: true },
    });
    const sourceIds = sources.map((s) => s.id);
    const sourceMap: Record<string, { label: string; sourceType: string }> = {};
    for (const s of sources) sourceMap[s.id] = { label: s.label, sourceType: s.sourceType };

    if (sourceIds.length === 0) {
      return Response.json({ messages: [], total: 0, stats: {} });
    }

    // Build where clause
    const where: Record<string, unknown> = { sourceId: { in: sourceIds } };
    if (messageType && messageType !== "ALL") where.messageType = messageType;
    if (sender) where.sender = { contains: sender, mode: "insensitive" };

    const [messages, total] = await Promise.all([
      prisma.backlogMessage.findMany({
        where,
        orderBy: { timestamp: "asc" },
        take: limit,
        skip: offset,
      }),
      prisma.backlogMessage.count({ where }),
    ]);

    // Compute stats
    const allMessages = await prisma.backlogMessage.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { sender: true, messageType: true, hasAttachment: true, timestamp: true },
    });

    const participants = [...new Set(allMessages.map((m) => m.sender))];
    const attachmentCount = allMessages.filter((m) => m.hasAttachment).length;
    const typeCounts: Record<string, number> = {};
    for (const m of allMessages) {
      typeCounts[m.messageType] = (typeCounts[m.messageType] || 0) + 1;
    }

    // Enrich messages with source label
    const enriched = messages.map((m) => ({
      ...m,
      sourceLabel: sourceMap[m.sourceId]?.label || "Unknown",
      sourceType: sourceMap[m.sourceId]?.sourceType || "Unknown",
    }));

    return Response.json({
      messages: enriched,
      total,
      limit,
      offset,
      stats: {
        messageCount: allMessages.length,
        participants,
        participantCount: participants.length,
        attachmentCount,
        dateFrom: allMessages.length > 0 ? allMessages.reduce((min, m) => m.timestamp < min ? m.timestamp : min, allMessages[0].timestamp) : null,
        dateTo: allMessages.length > 0 ? allMessages.reduce((max, m) => m.timestamp > max ? m.timestamp : max, allMessages[0].timestamp) : null,
        typeCounts,
      },
    });
  } catch (error) {
    console.error("Timeline failed:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

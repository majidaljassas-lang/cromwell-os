import { prisma } from "@/lib/prisma";

/**
 * POST: Import raw messages into a backlog source.
 * Body: { messages: Array<{ timestamp, sender, rawText, hasAttachment?, attachmentRef? }> }
 *
 * RULES:
 * - Store every line as-is
 * - Do NOT interpret, classify, or extract
 * - Keep exact order
 * - Keep timestamps and sender exactly
 * - If parsing fails, store raw anyway with type UNKNOWN
 * - NEVER discard
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const body = await request.json();
    const { messages } = body as {
      messages: Array<{
        timestamp: string;
        sender: string;
        rawText: string;
        hasAttachment?: boolean;
        attachmentRef?: string;
      }>;
    };

    if (!messages || !Array.isArray(messages)) {
      return Response.json({ error: "messages array required" }, { status: 400 });
    }

    const source = await prisma.backlogSource.findUnique({ where: { id: sourceId } });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });

    // Store every message — ZERO data loss
    const created = await prisma.backlogMessage.createMany({
      data: messages.map((m) => ({
        sourceId,
        timestamp: new Date(m.timestamp),
        sender: m.sender || "UNKNOWN",
        rawText: m.rawText || "",
        messageType: "UNCLASSIFIED",
        hasAttachment: m.hasAttachment || false,
        attachmentRef: m.attachmentRef,
      })),
    });

    // Update source metadata
    const allMsgs = await prisma.backlogMessage.findMany({
      where: { sourceId },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true, sender: true },
    });

    const senders = [...new Set(allMsgs.map((m) => m.sender))];
    const dateFrom = allMsgs[0]?.timestamp;
    const dateTo = allMsgs[allMsgs.length - 1]?.timestamp;

    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: {
        messageCount: allMsgs.length,
        participantList: senders,
        dateFrom,
        dateTo,
        importedAt: new Date(),
        status: "IMPORTED",
      },
    });

    return Response.json({
      imported: created.count,
      totalMessages: allMsgs.length,
      participants: senders,
      dateRange: { from: dateFrom, to: dateTo },
    }, { status: 201 });
  } catch (error) {
    console.error("Backlog import failed:", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}

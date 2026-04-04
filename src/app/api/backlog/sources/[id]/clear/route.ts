import { prisma } from "@/lib/prisma";

/**
 * POST: Clear all messages + raw import text from a source.
 * Keeps the source record itself so it can be re-imported.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deleted = await prisma.backlogMessage.deleteMany({ where: { sourceId: id } });

    await prisma.backlogSource.update({
      where: { id },
      data: {
        rawImportText: null,
        rawImportFilename: null,
        importBytes: 0,
        importLineCount: 0,
        importedAt: null,
        importStartedAt: null,
        importCompletedAt: null,
        parsedAt: null,
        parseStatus: "NOT_RUN",
        parseProgressPct: 0,
        unparsedLines: 0,
        messageCount: 0,
        participantList: [],
        dateFrom: null,
        dateTo: null,
        status: "CREATED",
      },
    });

    return Response.json({ cleared: true, messagesDeleted: deleted.count });
  } catch (error) {
    return Response.json({ error: "Failed to clear" }, { status: 500 });
  }
}

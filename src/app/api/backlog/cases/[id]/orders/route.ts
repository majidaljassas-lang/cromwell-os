import { prisma } from "@/lib/prisma";

/**
 * GET /api/backlog/cases/[id]/orders
 * Returns order threads with their lines, linked messages, and invoice data.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  try {
    // Fetch all order threads for this case
    const threads = await prisma.backlogOrderThread.findMany({
      where: { caseId },
      include: {
        orderLines: {
          include: {
            invoiceMatches: {
              include: {
                invoiceLine: {
                  include: {
                    document: true,
                  },
                },
              },
            },
          },
          orderBy: { date: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Collect all messageIds from all threads
    const allMessageIds = threads.flatMap((t) => t.messageIds);

    // Fetch all referenced messages
    const messages = allMessageIds.length > 0
      ? await prisma.backlogMessage.findMany({
          where: { id: { in: allMessageIds } },
          orderBy: { parsedTimestamp: "asc" },
        })
      : [];

    // Build a source map for the messages
    const sourceIds = [...new Set(messages.map((m) => m.sourceId))];
    const sources = sourceIds.length > 0
      ? await prisma.backlogSource.findMany({
          where: { id: { in: sourceIds } },
          select: { id: true, label: true, sourceType: true },
        })
      : [];
    const sourceMap: Record<string, { label: string; sourceType: string }> = {};
    for (const s of sources) sourceMap[s.id] = { label: s.label, sourceType: s.sourceType };

    // Fetch all invoice documents linked via invoice lines
    const documentIds = new Set<string>();
    for (const t of threads) {
      for (const line of t.orderLines) {
        for (const match of line.invoiceMatches) {
          if (match.invoiceLine.documentId) {
            documentIds.add(match.invoiceLine.documentId);
          }
        }
      }
    }

    const invoiceDocs = documentIds.size > 0
      ? await prisma.backlogInvoiceDocument.findMany({
          where: { id: { in: [...documentIds] } },
          include: { lines: true },
        })
      : [];
    const invoiceDocMap: Record<string, typeof invoiceDocs[number]> = {};
    for (const doc of invoiceDocs) invoiceDocMap[doc.id] = doc;

    // Build message map
    const messageMap: Record<string, typeof messages[number]> = {};
    for (const m of messages) messageMap[m.id] = m;

    // Also fetch any ticket lines not assigned to a thread (orphan lines)
    const orphanLines = await prisma.backlogTicketLine.findMany({
      where: { caseId, orderThreadId: null },
      include: {
        invoiceMatches: {
          include: {
            invoiceLine: {
              include: { document: true },
            },
          },
        },
      },
      orderBy: { date: "asc" },
    });

    // Summary stats
    const allLines = threads.flatMap((t) => t.orderLines);
    const totalLines = allLines.length + orphanLines.length;
    const invoicedCount = [...allLines, ...orphanLines].filter((l) => l.status === "INVOICED").length;
    const unmatchedCount = [...allLines, ...orphanLines].filter((l) => l.status === "UNMATCHED").length;
    const exceptionCount = [...allLines, ...orphanLines].filter((l) => l.status === "EXCEPTION").length;
    const messageLinkedCount = [...allLines, ...orphanLines].filter((l) => l.status === "MESSAGE_LINKED").length;

    const s = (v: unknown) => JSON.parse(JSON.stringify(v));

    return Response.json({
      threads: s(threads),
      messages: s(messageMap),
      sourceMap,
      invoiceDocs: s(invoiceDocMap),
      orphanLines: s(orphanLines),
      stats: {
        totalThreads: threads.length,
        totalLines,
        invoicedCount,
        unmatchedCount,
        exceptionCount,
        messageLinkedCount,
        invoicedPct: totalLines > 0 ? Math.round((invoicedCount / totalLines) * 100) : 0,
      },
    });
  } catch (err) {
    console.error("Failed to load order threads:", err);
    return Response.json({ error: "Failed to load order threads" }, { status: 500 });
  }
}

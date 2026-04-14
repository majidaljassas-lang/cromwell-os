import { prisma } from "@/lib/prisma";

/**
 * GET /api/backlog/cases/[id]/orders
 *
 * Returns EVERYTHING needed for the Orders tab:
 *  - Order threads with their lines, linked messages, and invoice data
 *  - Orphan ticket lines (no thread)
 *  - Suggested matches (lines whose notes contain "Possible match: INV-")
 *  - Unmatched invoice lines (invoice lines with no BacklogInvoiceMatch)
 *  - Image messages (hasMedia=true) with 2-message context window on each side
 *  - Headline money numbers: invoiced value, unmatched invoice value, gap estimate
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  try {
    const backlogCase = await prisma.backlogCase.findUnique({
      where: { id: caseId },
      select: { id: true, dateFrom: true, dateTo: true },
    });

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

    // Build a source map for the messages (start set, we add image-context sources later)
    const sourceIdsSet = new Set<string>(messages.map((m) => m.sourceId));

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

    // ========================================================================
    // SUGGESTED MATCHES — ticket lines whose notes contain "Possible match: INV"
    // ========================================================================
    const suggestedLines = await prisma.backlogTicketLine.findMany({
      where: {
        caseId,
        notes: { contains: "Possible match: INV", mode: "insensitive" },
      },
      include: {
        invoiceMatches: {
          include: {
            invoiceLine: { include: { document: true } },
          },
        },
        orderThread: { select: { id: true, label: true } },
      },
      orderBy: { date: "desc" },
    });

    // Extract invoice numbers from notes and pre-fetch those invoice lines so UI
    // can render them inline without another round-trip.
    const suggestedInvoiceNumbers = new Set<string>();
    const invNumRegex = /Possible match:\s*(INV[-\s]?[A-Za-z0-9\-_]+)/gi;
    for (const line of suggestedLines) {
      if (!line.notes) continue;
      let m: RegExpExecArray | null;
      invNumRegex.lastIndex = 0;
      while ((m = invNumRegex.exec(line.notes)) != null) {
        suggestedInvoiceNumbers.add(m[1].replace(/\s+/g, "").toUpperCase());
      }
    }

    const suggestedInvoiceLines = suggestedInvoiceNumbers.size > 0
      ? await prisma.backlogInvoiceLine.findMany({
          where: {
            caseId,
            invoiceNumber: { in: [...suggestedInvoiceNumbers], mode: "insensitive" },
          },
          include: { document: true },
        })
      : [];
    // Index by normalized invoice number
    const suggestedInvoiceIndex: Record<string, typeof suggestedInvoiceLines> = {};
    for (const il of suggestedInvoiceLines) {
      const key = il.invoiceNumber.replace(/\s+/g, "").toUpperCase();
      if (!suggestedInvoiceIndex[key]) suggestedInvoiceIndex[key] = [];
      suggestedInvoiceIndex[key].push(il);
    }

    // ========================================================================
    // UNMATCHED INVOICE LINES — invoice lines with no BacklogInvoiceMatch
    // ========================================================================
    const unmatchedInvoiceLines = await prisma.backlogInvoiceLine.findMany({
      where: {
        caseId,
        invoiceMatches: { none: {} },
      },
      include: { document: true },
      orderBy: { invoiceDate: "desc" },
    });

    // ========================================================================
    // IMAGES — messages with hasMedia=true inside the case source pool
    // Build context (2 messages before + 2 after) for each image.
    // ========================================================================
    // Collect source ids from the case
    const caseSources = await prisma.backlogSource.findMany({
      where: { group: { caseId } },
      select: { id: true, label: true, sourceType: true },
    });
    const caseSourceIds = caseSources.map((s) => s.id);

    const imageMessages = caseSourceIds.length > 0
      ? await prisma.backlogMessage.findMany({
          where: {
            sourceId: { in: caseSourceIds },
            hasMedia: true,
          },
          orderBy: { parsedTimestamp: "asc" },
        })
      : [];

    // For context, fetch every message per source and pick neighbors by lineNumber.
    // We only do this if there are images — otherwise skip the expensive pull.
    const contextMap: Record<string, { before: typeof imageMessages; after: typeof imageMessages }> = {};
    if (imageMessages.length > 0) {
      // Group image messages by source
      const bySource: Record<string, typeof imageMessages> = {};
      for (const im of imageMessages) {
        if (!bySource[im.sourceId]) bySource[im.sourceId] = [];
        bySource[im.sourceId].push(im);
      }

      // For each source that has images, fetch all its messages ordered by lineNumber.
      for (const srcId of Object.keys(bySource)) {
        const srcMessages = await prisma.backlogMessage.findMany({
          where: { sourceId: srcId },
          orderBy: [{ parsedTimestamp: "asc" }, { lineNumber: "asc" }],
        });
        // Index by id for quick lookup
        const idxById = new Map<string, number>();
        srcMessages.forEach((m, i) => idxById.set(m.id, i));
        for (const im of bySource[srcId]) {
          const idx = idxById.get(im.id);
          if (idx === undefined) continue;
          const before = srcMessages.slice(Math.max(0, idx - 2), idx);
          const after = srcMessages.slice(idx + 1, idx + 3);
          contextMap[im.id] = { before, after };
          // Ensure source map covers these
          for (const m of [...before, ...after]) sourceIdsSet.add(m.sourceId);
        }
      }
    }

    // Compile source map (for threads + image context)
    for (const s of caseSources) sourceIdsSet.add(s.id);
    const sources = sourceIdsSet.size > 0
      ? await prisma.backlogSource.findMany({
          where: { id: { in: [...sourceIdsSet] } },
          select: { id: true, label: true, sourceType: true },
        })
      : [];
    const sourceMap: Record<string, { label: string; sourceType: string }> = {};
    for (const s of sources) sourceMap[s.id] = { label: s.label, sourceType: s.sourceType };

    // ========================================================================
    // STATS
    // ========================================================================
    const allLines = threads.flatMap((t) => t.orderLines);
    const totalLines = allLines.length + orphanLines.length;
    const invoicedCount = [...allLines, ...orphanLines].filter((l) => l.status === "INVOICED").length;
    const unmatchedCount = [...allLines, ...orphanLines].filter((l) => l.status === "UNMATCHED").length;
    const exceptionCount = [...allLines, ...orphanLines].filter((l) => l.status === "EXCEPTION").length;
    const messageLinkedCount = [...allLines, ...orphanLines].filter((l) => l.status === "MESSAGE_LINKED").length;

    // Money: total invoiced = sum of amounts on invoice lines that are matched
    // Total unmatched invoice value = sum of amount on unmatched invoice lines
    // Gap estimate: unmatched ticket lines × average invoice rate per normalizedProduct
    const matchedInvoiceLineIds = new Set<string>();
    for (const t of threads) {
      for (const ol of t.orderLines) {
        for (const m of ol.invoiceMatches) matchedInvoiceLineIds.add(m.invoiceLine.id);
      }
    }
    for (const ol of orphanLines) {
      for (const m of ol.invoiceMatches) matchedInvoiceLineIds.add(m.invoiceLine.id);
    }

    // Pull all invoice lines for the case once so we can sum invoiced vs unmatched
    const allInvoiceLines = await prisma.backlogInvoiceLine.findMany({
      where: { caseId },
      select: {
        id: true,
        amount: true,
        rate: true,
        qty: true,
        normalizedProduct: true,
      },
    });

    let invoicedValue = 0;
    let unmatchedInvoiceValue = 0;
    const rateByProduct: Record<string, { total: number; count: number }> = {};
    for (const il of allInvoiceLines) {
      const amt = il.amount ? Number(il.amount) : 0;
      if (matchedInvoiceLineIds.has(il.id)) invoicedValue += amt;
      else unmatchedInvoiceValue += amt;

      if (il.rate != null) {
        const p = il.normalizedProduct || "UNKNOWN";
        if (!rateByProduct[p]) rateByProduct[p] = { total: 0, count: 0 };
        rateByProduct[p].total += Number(il.rate);
        rateByProduct[p].count += 1;
      }
    }

    // Gap estimate: for every UNMATCHED ticket line, multiply qty × avg rate of that product
    let gapEstimateValue = 0;
    let gapUnknownLines = 0;
    for (const l of [...allLines, ...orphanLines]) {
      if (l.status !== "UNMATCHED") continue;
      const p = l.normalizedProduct || "UNKNOWN";
      const avg = rateByProduct[p] && rateByProduct[p].count > 0
        ? rateByProduct[p].total / rateByProduct[p].count
        : null;
      if (avg == null) {
        gapUnknownLines += 1;
        continue;
      }
      gapEstimateValue += Number(l.requestedQty) * avg;
    }

    const s = (v: unknown) => JSON.parse(JSON.stringify(v));

    return Response.json({
      threads: s(threads),
      messages: s(messageMap),
      sourceMap,
      invoiceDocs: s(invoiceDocMap),
      orphanLines: s(orphanLines),
      suggestedLines: s(suggestedLines),
      suggestedInvoiceIndex: s(suggestedInvoiceIndex),
      unmatchedInvoiceLines: s(unmatchedInvoiceLines),
      imageMessages: s(imageMessages),
      imageContext: s(contextMap),
      caseInfo: {
        dateFrom: backlogCase?.dateFrom ?? null,
        dateTo: backlogCase?.dateTo ?? null,
      },
      stats: {
        totalThreads: threads.length,
        totalLines,
        invoicedCount,
        unmatchedCount,
        exceptionCount,
        messageLinkedCount,
        suggestedCount: suggestedLines.length,
        unmatchedInvoiceLineCount: unmatchedInvoiceLines.length,
        imageCount: imageMessages.length,
        invoicedPct: totalLines > 0 ? Math.round((invoicedCount / totalLines) * 100) : 0,
      },
      money: {
        invoicedValue: Number(invoicedValue.toFixed(2)),
        unmatchedInvoiceValue: Number(unmatchedInvoiceValue.toFixed(2)),
        gapEstimateValue: Number(gapEstimateValue.toFixed(2)),
        gapUnknownLines,
      },
    });
  } catch (err) {
    console.error("Failed to load order threads:", err);
    return Response.json({ error: "Failed to load order threads" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

/**
 * Ingestion Inbox — Feed Review Queue
 *
 * Surfaces events that need confirmation, correction, or override.
 * Filters: source type, confidence, unresolved site, unresolved cost, recovery relevance.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceType = searchParams.get("sourceType");
    const maxConfidence = searchParams.get("maxConfidence");
    const unresolvedSite = searchParams.get("unresolvedSite") === "true";
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Build where clause for events needing review
    const where: Record<string, unknown> = {
      status: status || { in: ["PARSED", "NORMALISED", "CLASSIFIED", "MATCHED"] },
    };

    if (sourceType) {
      where.source = { sourceType };
    }

    // Get events with parsed data
    const events = await prisma.ingestionEvent.findMany({
      where,
      include: {
        source: { select: { sourceType: true, accountName: true } },
        parsedMessages: {
          orderBy: { parseVersion: "desc" as const },
          take: 1,
          select: {
            id: true,
            extractedText: true,
            messageType: true,
            confidenceScore: true,
            structuredData: true,
            ingestionLinks: {
              select: { id: true, linkStatus: true, linkConfidence: true },
            },
          },
        },
        sourceSiteMatches: {
          select: {
            id: true,
            rawSiteText: true,
            reviewStatus: true,
            confidenceScore: true,
            matchedSite: { select: { id: true, siteName: true } },
          },
        },
      },
      orderBy: { receivedAt: "desc" },
      take: limit,
      skip: offset,
    });

    // Filter by confidence if specified
    let filtered = events;
    if (maxConfidence) {
      const maxConf = parseFloat(maxConfidence);
      filtered = events.filter((e) => {
        const conf = e.parsedMessages[0]?.confidenceScore;
        return conf == null || Number(conf) <= maxConf;
      });
    }

    // Filter by unresolved site if specified
    if (unresolvedSite) {
      filtered = filtered.filter((e) =>
        e.sourceSiteMatches.some((m) => m.reviewStatus === "UNRESOLVED")
      );
    }

    // Build inbox items with summary
    const inboxItems = filtered.map((event) => {
      const latestParse = event.parsedMessages[0];
      const structured = latestParse?.structuredData as Record<string, unknown> | null;
      const hasUnresolvedSite = event.sourceSiteMatches.some(
        (m) => m.reviewStatus === "UNRESOLVED"
      );
      const isLinked = (latestParse?.ingestionLinks?.length ?? 0) > 0;

      return {
        eventId: event.id,
        sourceType: event.source.sourceType,
        sourceAccount: event.source.accountName,
        sourceRecordType: event.sourceRecordType,
        eventKind: event.eventKind,
        receivedAt: event.receivedAt,
        status: event.status,
        summary: latestParse?.extractedText?.slice(0, 200) || "No parsed content",
        confidence: latestParse?.confidenceScore ? Number(latestParse.confidenceScore) : null,
        messageType: latestParse?.messageType,
        siteGuess: structured?.siteGuess || structured?.siteRef || null,
        customerGuess: structured?.customerGuess || structured?.customerRef || null,
        hasUnresolvedSite,
        isLinked,
        unresolvedSiteMatches: event.sourceSiteMatches.filter(
          (m) => m.reviewStatus === "UNRESOLVED"
        ),
      };
    });

    const total = await prisma.ingestionEvent.count({ where });

    return Response.json({ items: inboxItems, total, limit, offset });
  } catch (error) {
    console.error("Failed to fetch ingestion inbox:", error);
    return Response.json({ error: "Failed to fetch inbox" }, { status: 500 });
  }
}

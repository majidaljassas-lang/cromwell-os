import { prisma } from "@/lib/prisma";
import { matchSite } from "@/lib/ingestion/matching";

/**
 * Site Resolution Queue
 * GET: list unresolved site matches with suggestions
 * POST: run matching on a raw site text and return suggestions
 */

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "UNRESOLVED";
    const limit = parseInt(searchParams.get("limit") || "50");

    const matches = await prisma.sourceSiteMatch.findMany({
      where: { reviewStatus: status },
      include: {
        matchedSite: { select: { id: true, siteName: true, siteCode: true, postcode: true } },
        ingestionEvent: {
          select: {
            id: true,
            sourceRecordType: true,
            eventKind: true,
            receivedAt: true,
            source: { select: { sourceType: true, accountName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // For each unresolved match, run the matching engine to get suggestions
    const enriched = await Promise.all(
      matches.map(async (m) => {
        const suggestions = m.reviewStatus === "UNRESOLVED"
          ? await matchSite(m.rawSiteText)
          : [];

        // Count how many other records share this raw site text
        const affectedCount = await prisma.sourceSiteMatch.count({
          where: { rawSiteText: { equals: m.rawSiteText, mode: "insensitive" } },
        });

        return {
          ...m,
          suggestions,
          affectedCount,
        };
      })
    );

    return Response.json(enriched);
  } catch (error) {
    console.error("Failed to fetch site resolution queue:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { rawSiteText } = await request.json();
    if (!rawSiteText) {
      return Response.json({ error: "rawSiteText required" }, { status: 400 });
    }

    const suggestions = await matchSite(rawSiteText);
    return Response.json({ rawSiteText, suggestions });
  } catch (error) {
    console.error("Site matching failed:", error);
    return Response.json({ error: "Matching failed" }, { status: 500 });
  }
}

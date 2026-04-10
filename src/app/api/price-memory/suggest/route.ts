import { prisma } from "@/lib/prisma";

type DecimalLike = { toString(): string } | string | number | null;

type SuggestLine = {
  id: string;
  description: string;
  normalizedItemName: string | null;
  qty: DecimalLike;
  unit: string;
  expectedCostUnit: DecimalLike;
  actualSaleUnit: DecimalLike;
  supplierId: string | null;
  supplierName: string | null;
  createdAt: Date;
};

type ScoredLine = SuggestLine & { matchCount: number; matchRatio: number };

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const description = searchParams.get("description")?.trim();

    if (!description) {
      return Response.json(
        { error: "description query parameter is required" },
        { status: 400 }
      );
    }

    // Split description into words for fuzzy matching
    const words = description
      .split(/\s+/)
      .filter((w: string) => w.length >= 2) // Skip single-char words
      .map((w: string) => w.replace(/[^a-zA-Z0-9]/g, "")) // Strip special chars
      .filter(Boolean);

    if (words.length === 0) {
      return Response.json({
        suggestedCost: null,
        suggestedSale: null,
        suggestedMargin: null,
        similarItems: [],
      });
    }

    // Find ticket lines where description contains any of the words
    // We score by how many words match
    const orConditions = words.map((word: string) => ({
      OR: [
        { description: { contains: word, mode: "insensitive" as const } },
        { normalizedItemName: { contains: word, mode: "insensitive" as const } },
      ],
    }));

    // Get lines that match at least one word
    const lines: SuggestLine[] = await prisma.ticketLine.findMany({
      where: {
        OR: orConditions,
      },
      select: {
        id: true,
        description: true,
        normalizedItemName: true,
        qty: true,
        unit: true,
        expectedCostUnit: true,
        actualSaleUnit: true,
        supplierId: true,
        supplierName: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    // Score each line by how many search words appear in its description
    const scored: ScoredLine[] = lines.map((line: SuggestLine) => {
      const text = `${line.description ?? ""} ${line.normalizedItemName ?? ""}`.toLowerCase();
      const matchCount = words.filter((w: string) =>
        text.includes(w.toLowerCase())
      ).length;
      const matchRatio = matchCount / words.length;
      return { ...line, matchCount, matchRatio };
    });

    // Filter to lines that match at least half the words, sorted by match quality then date
    const relevant = scored
      .filter((l: ScoredLine) => l.matchRatio >= 0.5)
      .sort((a: ScoredLine, b: ScoredLine) => {
        if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

    // Build similar items list
    const similarItems = relevant.slice(0, 20).map((line: ScoredLine) => ({
      description: line.description,
      normalizedItemName: line.normalizedItemName,
      costUnit: line.expectedCostUnit ? Number(line.expectedCostUnit) : null,
      saleUnit: line.actualSaleUnit ? Number(line.actualSaleUnit) : null,
      supplierName: line.supplierName,
      date: line.createdAt,
      matchScore: Math.round(line.matchRatio * 100),
      unit: line.unit,
    }));

    // Compute suggestions from the best matches
    const bestMatches = relevant.filter((l: ScoredLine) => l.matchRatio >= 0.75);
    const fallbackMatches = bestMatches.length > 0 ? bestMatches : relevant.slice(0, 10);

    const costs = fallbackMatches
      .map((l: ScoredLine) => Number(l.expectedCostUnit ?? 0))
      .filter((c: number) => c > 0);
    const sales = fallbackMatches
      .map((l: ScoredLine) => Number(l.actualSaleUnit ?? 0))
      .filter((s: number) => s > 0);

    // Use the most recent price as suggestion (index 0 = most recent due to sort)
    const suggestedCost = costs.length > 0 ? costs[0] : null;
    const suggestedSale = sales.length > 0 ? sales[0] : null;
    const suggestedMargin =
      suggestedCost !== null && suggestedSale !== null && suggestedCost > 0
        ? Math.round(((suggestedSale - suggestedCost) / suggestedSale) * 10000) / 100
        : null;

    return Response.json({
      suggestedCost,
      suggestedSale,
      suggestedMargin,
      similarItems,
      meta: {
        searchTerms: words,
        totalMatches: relevant.length,
        bestMatchCount: bestMatches.length,
      },
    });
  } catch (error) {
    console.error("Failed to suggest price:", error);
    return Response.json(
      { error: "Failed to suggest price" },
      { status: 500 }
    );
  }
}

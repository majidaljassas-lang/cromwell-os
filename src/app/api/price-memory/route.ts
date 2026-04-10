import { prisma } from "@/lib/prisma";

type DecimalLike = { toString(): string } | string | number | null;

type PriceLine = {
  id: string;
  description: string;
  normalizedItemName: string | null;
  qty: DecimalLike;
  unit: string;
  expectedCostUnit: DecimalLike;
  actualSaleUnit: DecimalLike;
  actualCostTotal: DecimalLike;
  actualSaleTotal: DecimalLike;
  supplierId: string | null;
  supplierName: string | null;
  createdAt: Date;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() || null;
    const supplierId = searchParams.get("supplierId") || null;

    // Build where clause for filtering
    const where: Record<string, unknown> = {};
    if (supplierId) {
      where.supplierId = supplierId;
    }

    // If searching, split into words and require all words to appear in description or normalizedItemName
    if (search) {
      const words = search.split(/\s+/).filter(Boolean);
      where.AND = words.map((word: string) => ({
        OR: [
          { description: { contains: word, mode: "insensitive" } },
          { normalizedItemName: { contains: word, mode: "insensitive" } },
        ],
      }));
    }

    // Get all matching ticket lines with pricing data
    const lines: PriceLine[] = await prisma.ticketLine.findMany({
      where,
      select: {
        id: true,
        description: true,
        normalizedItemName: true,
        qty: true,
        unit: true,
        expectedCostUnit: true,
        actualSaleUnit: true,
        actualCostTotal: true,
        actualSaleTotal: true,
        supplierId: true,
        supplierName: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    // Group by normalizedItemName or description
    const grouped: Record<
      string,
      {
        productName: string;
        entries: PriceLine[];
      }
    > = {};

    for (const line of lines) {
      const key = (line.normalizedItemName || line.description || "Unknown").toLowerCase().trim();
      if (!grouped[key]) {
        grouped[key] = {
          productName: line.normalizedItemName || line.description || "Unknown",
          entries: [],
        };
      }
      grouped[key].entries.push(line);
    }

    // Build price memory result
    const result = Object.values(grouped).map((group) => {
      const entries = group.entries;
      const costs = entries
        .map((e: PriceLine) => Number(e.expectedCostUnit ?? 0))
        .filter((c: number) => c > 0);
      const sales = entries
        .map((e: PriceLine) => Number(e.actualSaleUnit ?? 0))
        .filter((s: number) => s > 0);

      const lastBuyPrice = costs.length > 0 ? costs[0] : null;
      const lastSellPrice = sales.length > 0 ? sales[0] : null;
      const avgBuyPrice =
        costs.length > 0 ? costs.reduce((a: number, b: number) => a + b, 0) / costs.length : null;
      const avgSellPrice =
        sales.length > 0 ? sales.reduce((a: number, b: number) => a + b, 0) / sales.length : null;

      // Price trend: compare last price to average
      let priceTrend: "RISING" | "FALLING" | "STABLE" | "UNKNOWN" = "UNKNOWN";
      if (lastBuyPrice !== null && avgBuyPrice !== null && costs.length >= 2) {
        const diff = ((lastBuyPrice - avgBuyPrice) / avgBuyPrice) * 100;
        if (diff > 5) priceTrend = "RISING";
        else if (diff < -5) priceTrend = "FALLING";
        else priceTrend = "STABLE";
      }

      const suppliers = [
        ...new Set(entries.map((e: PriceLine) => e.supplierName).filter(Boolean)),
      ];

      return {
        productName: group.productName,
        occurrences: entries.length,
        lastBuyPrice,
        lastSellPrice,
        avgBuyPrice: avgBuyPrice !== null ? Math.round(avgBuyPrice * 100) / 100 : null,
        avgSellPrice: avgSellPrice !== null ? Math.round(avgSellPrice * 100) / 100 : null,
        priceTrend,
        suppliers,
        lastSeen: entries[0]?.createdAt ?? null,
        unit: entries[0]?.unit ?? null,
      };
    });

    // Sort by most recent first
    result.sort((a, b) => {
      if (!a.lastSeen || !b.lastSeen) return 0;
      return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to get price memory:", error);
    return Response.json(
      { error: "Failed to get price memory" },
      { status: 500 }
    );
  }
}

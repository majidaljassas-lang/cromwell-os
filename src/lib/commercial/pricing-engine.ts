/**
 * Pricing Engine — Customer-specific historic pricing memory and auto-suggestion
 *
 * For each customer + product combination:
 * 1. Look up historic prices from PricingHistory (invoices, quotes, manual)
 * 2. Calculate: last price, average (last 5), price range
 * 3. Suggest price with confidence and source metadata
 *
 * Priority:
 *   1. Customer-specific history (most recent first)
 *   2. Same-customer-group history (if customer has parent entity)
 *   3. Fallback: cost + default margin
 *
 * Pricing lock: if customer.pricingLocked, enforce last price — no deviation.
 */

import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PricingSuggestion {
  canonicalProductId: string;
  productCode: string;
  productName: string;
  costPrice: number | null;
  suggestedSalePrice: number;
  marginAmount: number | null;
  marginPct: number | null;
  source: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  lastPrice: number | null;
  averagePrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  historyCount: number;
  priceRange: string | null;
  pricingLocked: boolean;
  metadata: {
    customerName: string;
    historyDates: string[];
    sources: string[];
  };
}

export interface PricingRequest {
  customerId: string;
  canonicalProductId: string;
  costPrice?: number | null;
  qty?: number;
  siteId?: string | null;
}

// ─── Default margin ─────────────────────────────────────────────────────────

const DEFAULT_MARGIN_PCT = 25; // 25% markup on cost if no history exists

// ─── Core Engine ────────────────────────────────────────────────────────────

export async function suggestPrice(req: PricingRequest): Promise<PricingSuggestion> {
  const { customerId, canonicalProductId, costPrice, siteId } = req;

  // Get customer
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      pricingLocked: true,
      defaultMarginPct: true,
      parentCustomerEntityId: true,
    },
  });

  if (!customer) throw new Error("Customer not found");

  // Get product
  const product = await prisma.canonicalProduct.findUnique({
    where: { id: canonicalProductId },
  });

  if (!product) throw new Error("Canonical product not found");

  // ─── Step 1: Customer-specific history ──────────────────────────────

  const history = await prisma.pricingHistory.findMany({
    where: { customerId, canonicalProductId },
    orderBy: { date: "desc" },
    take: 10,
  });

  // ─── Step 2: If no history, check parent customer group ─────────────

  let groupHistory: typeof history = [];
  if (history.length === 0 && customer.parentCustomerEntityId) {
    // Check sibling customers in the same group
    const siblings = await prisma.customer.findMany({
      where: { parentCustomerEntityId: customer.parentCustomerEntityId },
      select: { id: true },
    });
    const siblingIds = siblings.map((s) => s.id);

    groupHistory = await prisma.pricingHistory.findMany({
      where: {
        customerId: { in: siblingIds },
        canonicalProductId,
      },
      orderBy: { date: "desc" },
      take: 10,
    });
  }

  // Use whichever history is available
  const effectiveHistory = history.length > 0 ? history : groupHistory;
  const isGroupFallback = history.length === 0 && groupHistory.length > 0;

  // ─── Step 3: Calculate metrics ──────────────────────────────────────

  if (effectiveHistory.length > 0) {
    const prices = effectiveHistory.map((h) => Number(h.salePrice));
    const last5 = prices.slice(0, 5);

    const lastPrice = prices[0];
    const averagePrice = last5.reduce((a, b) => a + b, 0) / last5.length;
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const historyCount = effectiveHistory.length;

    // Confidence based on history depth and recency
    const daysSinceLast = (Date.now() - new Date(effectiveHistory[0].date).getTime()) / (1000 * 60 * 60 * 24);
    let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
    if (historyCount >= 3 && daysSinceLast < 90) confidence = "HIGH";
    else if (historyCount >= 1 && daysSinceLast < 180) confidence = "MEDIUM";

    // If pricing locked, enforce last price
    const suggestedSalePrice = customer.pricingLocked ? lastPrice : averagePrice;

    // Calculate margin against provided cost
    const cost = costPrice ?? (effectiveHistory[0].costPrice ? Number(effectiveHistory[0].costPrice) : null);
    const marginAmount = cost !== null ? suggestedSalePrice - cost : null;
    const marginPct = cost !== null && cost > 0 ? ((suggestedSalePrice - cost) / suggestedSalePrice) * 100 : null;

    const sourceLabel = isGroupFallback
      ? `${customer.name} group historic pricing`
      : `${customer.name} historic pricing`;

    return {
      canonicalProductId,
      productCode: product.code,
      productName: product.name,
      costPrice: cost,
      suggestedSalePrice: round(suggestedSalePrice),
      marginAmount: marginAmount !== null ? round(marginAmount) : null,
      marginPct: marginPct !== null ? round(marginPct) : null,
      source: sourceLabel,
      confidence,
      lastPrice: round(lastPrice),
      averagePrice: round(averagePrice),
      minPrice: round(minPrice),
      maxPrice: round(maxPrice),
      historyCount,
      priceRange: minPrice !== maxPrice ? `£${round(minPrice)} – £${round(maxPrice)}` : null,
      pricingLocked: customer.pricingLocked,
      metadata: {
        customerName: customer.name,
        historyDates: effectiveHistory.map((h) => h.date.toISOString().slice(0, 10)),
        sources: [...new Set(effectiveHistory.map((h) => h.source))],
      },
    };
  }

  // ─── Step 4: Fallback — cost + default margin ──────────────────────

  const marginPct = customer.defaultMarginPct
    ? Number(customer.defaultMarginPct)
    : DEFAULT_MARGIN_PCT;

  const cost = costPrice ?? 0;
  const suggestedSalePrice = cost > 0 ? cost / (1 - marginPct / 100) : 0;
  const marginAmount = suggestedSalePrice - cost;

  return {
    canonicalProductId,
    productCode: product.code,
    productName: product.name,
    costPrice: cost > 0 ? cost : null,
    suggestedSalePrice: round(suggestedSalePrice),
    marginAmount: cost > 0 ? round(marginAmount) : null,
    marginPct,
    source: cost > 0 ? `Cost + ${marginPct}% margin (no customer history)` : "No pricing data available",
    confidence: cost > 0 ? "LOW" : "LOW",
    lastPrice: null,
    averagePrice: null,
    minPrice: null,
    maxPrice: null,
    historyCount: 0,
    priceRange: null,
    pricingLocked: customer.pricingLocked,
    metadata: {
      customerName: customer.name,
      historyDates: [],
      sources: [],
    },
  };
}

// ─── Batch suggestions ──────────────────────────────────────────────────────

export async function suggestPriceBatch(
  customerId: string,
  lines: Array<{ canonicalProductId: string; costPrice?: number | null; qty?: number }>
): Promise<PricingSuggestion[]> {
  const results: PricingSuggestion[] = [];
  for (const line of lines) {
    const suggestion = await suggestPrice({
      customerId,
      canonicalProductId: line.canonicalProductId,
      costPrice: line.costPrice,
      qty: line.qty,
    });
    results.push(suggestion);
  }
  return results;
}

// ─── Record pricing (from invoice/quote creation) ───────────────────────────

export async function recordPrice(params: {
  customerId: string;
  canonicalProductId: string;
  salePrice: number;
  costPrice?: number | null;
  qty: number;
  date: Date;
  siteId?: string | null;
  source: string;
  sourceRef?: string | null;
}): Promise<void> {
  const marginAmount = params.costPrice != null ? params.salePrice - params.costPrice : null;
  const marginPct = params.costPrice != null && params.salePrice > 0
    ? ((params.salePrice - params.costPrice) / params.salePrice) * 100
    : null;

  await prisma.pricingHistory.create({
    data: {
      customerId: params.customerId,
      canonicalProductId: params.canonicalProductId,
      salePrice: params.salePrice,
      costPrice: params.costPrice,
      qty: params.qty,
      marginAmount,
      marginPct,
      date: params.date,
      siteId: params.siteId,
      source: params.source,
      sourceRef: params.sourceRef,
    },
  });
}

// ─── Get pricing history for a customer + product ───────────────────────────

export async function getPricingHistory(
  customerId: string,
  canonicalProductId?: string
): Promise<any[]> {
  const where: Record<string, unknown> = { customerId };
  if (canonicalProductId) where.canonicalProductId = canonicalProductId;

  return prisma.pricingHistory.findMany({
    where,
    include: { canonicalProduct: true },
    orderBy: { date: "desc" },
    take: 50,
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

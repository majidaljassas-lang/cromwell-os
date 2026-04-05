import { prisma } from "@/lib/prisma";
import {
  suggestPrice,
  suggestPriceBatch,
  recordPrice,
  getPricingHistory,
} from "@/lib/commercial/pricing-engine";

/**
 * GET /api/commercial/pricing?customerId=xxx&productId=xxx
 * Get pricing history and suggestion for a customer + product.
 *
 * POST /api/commercial/pricing
 * Actions: suggest (single/batch), record, ingest (from existing invoices/quotes)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get("customerId");
    const productId = searchParams.get("productId");
    const costPrice = searchParams.get("costPrice");

    if (!customerId) {
      return Response.json({ error: "customerId required" }, { status: 400 });
    }

    // If productId provided, get suggestion + history
    if (productId) {
      const suggestion = await suggestPrice({
        customerId,
        canonicalProductId: productId,
        costPrice: costPrice ? parseFloat(costPrice) : null,
      });

      const history = await getPricingHistory(customerId, productId);

      return Response.json({
        suggestion,
        history: JSON.parse(JSON.stringify(history)),
      });
    }

    // Otherwise, get all history for customer
    const history = await getPricingHistory(customerId);
    return Response.json({
      history: JSON.parse(JSON.stringify(history)),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "suggest": {
        // Single suggestion
        const { customerId, canonicalProductId, costPrice } = body;
        if (!customerId || !canonicalProductId) {
          return Response.json({ error: "customerId and canonicalProductId required" }, { status: 400 });
        }
        const suggestion = await suggestPrice({ customerId, canonicalProductId, costPrice });
        return Response.json(suggestion);
      }

      case "suggest_batch": {
        // Batch suggestions for quote generation
        const { customerId, lines } = body;
        if (!customerId || !lines) {
          return Response.json({ error: "customerId and lines required" }, { status: 400 });
        }
        const suggestions = await suggestPriceBatch(customerId, lines);
        return Response.json({ suggestions });
      }

      case "record": {
        // Record a new price entry
        const { customerId, canonicalProductId, salePrice, costPrice, qty, date, siteId, source, sourceRef } = body;
        if (!customerId || !canonicalProductId || salePrice === undefined || !qty) {
          return Response.json({ error: "customerId, canonicalProductId, salePrice, qty required" }, { status: 400 });
        }
        await recordPrice({
          customerId,
          canonicalProductId,
          salePrice,
          costPrice,
          qty,
          date: date ? new Date(date) : new Date(),
          siteId,
          source: source || "MANUAL",
          sourceRef,
        });
        return Response.json({ recorded: true });
      }

      case "ingest": {
        // Ingest pricing from existing commercial invoices
        const result = await ingestFromInvoices();
        return Response.json(result);
      }

      case "lock": {
        // Lock/unlock customer pricing
        const { customerId, locked } = body;
        if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });
        await prisma.customer.update({
          where: { id: customerId },
          data: { pricingLocked: locked ?? true },
        });
        return Response.json({ customerId, pricingLocked: locked ?? true });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

// ─── Ingest from existing invoices and quotes ───────────────────────────────

async function ingestFromInvoices(): Promise<{ invoiceLines: number; quoteLines: number }> {
  let invoiceLines = 0;
  let quoteLines = 0;

  // From CommercialInvoice lines
  const ciLines = await prisma.commercialInvoiceLine.findMany({
    where: {
      canonicalProductId: { not: null },
      sellRate: { not: null },
    },
    include: {
      commercialInvoice: true,
      canonicalProduct: true,
    },
  });

  for (const line of ciLines) {
    if (!line.canonicalProductId || !line.commercialInvoice.customerId) continue;
    if (!line.sellRate) continue;

    // Check for duplicate
    const existing = await prisma.pricingHistory.findFirst({
      where: {
        customerId: line.commercialInvoice.customerId,
        canonicalProductId: line.canonicalProductId,
        sourceRef: `CommercialInvoiceLine:${line.id}`,
      },
    });
    if (existing) continue;

    await recordPrice({
      customerId: line.commercialInvoice.customerId,
      canonicalProductId: line.canonicalProductId,
      salePrice: Number(line.sellRate),
      qty: Number(line.qty),
      date: line.commercialInvoice.invoiceDate,
      siteId: line.commercialInvoice.siteId,
      source: "INVOICE",
      sourceRef: `CommercialInvoiceLine:${line.id}`,
    });
    invoiceLines++;
  }

  // From Quote lines (that have pricing)
  const qLines = await prisma.quoteLine.findMany({
    include: {
      quote: true,
      ticketLine: true,
    },
  });

  for (const line of qLines) {
    if (!line.ticketLine?.productCode || !line.quote.customerId) continue;

    const cp = await prisma.canonicalProduct.findUnique({
      where: { code: line.ticketLine.productCode },
    });
    if (!cp) continue;

    const existing = await prisma.pricingHistory.findFirst({
      where: {
        customerId: line.quote.customerId,
        canonicalProductId: cp.id,
        sourceRef: `QuoteLine:${line.id}`,
      },
    });
    if (existing) continue;

    await recordPrice({
      customerId: line.quote.customerId,
      canonicalProductId: cp.id,
      salePrice: Number(line.unitPrice),
      qty: Number(line.qty),
      date: line.quote.issuedAt || line.quote.createdAt,
      siteId: line.quote.siteId,
      source: "QUOTE",
      sourceRef: `QuoteLine:${line.id}`,
    });
    quoteLines++;
  }

  return { invoiceLines, quoteLines };
}

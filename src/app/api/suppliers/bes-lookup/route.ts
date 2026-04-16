/**
 * POST /api/suppliers/bes-lookup
 *
 * Look up BES product codes and optionally populate TicketLinePrice rows.
 *
 * Body:
 *   items: Array<{ code: string; qty: number }>
 *   ticketId?: string     — if provided, creates/updates ticket lines + prices
 *   supplierName?: string — defaults to "BES"
 *
 * Returns: { products, notFound, errors, ticketLinesCreated?, ticketLinesPriced? }
 */

import { prisma } from "@/lib/prisma";
import { besLookup } from "@/lib/suppliers/bes-lookup";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json();
  const { items, ticketId, supplierName = "BES" } = body as {
    items: Array<{ code: string; qty: number }>;
    ticketId?: string;
    supplierName?: string;
  };

  if (!items || !Array.isArray(items) || items.length === 0) {
    return Response.json({ error: "items array required: [{ code, qty }]" }, { status: 400 });
  }

  // Look up all codes
  const codes = items.map((i) => i.code);
  const result = await besLookup(codes);

  // Build a qty map from the request
  const qtyMap = new Map(items.map((i) => [i.code, i.qty]));

  // If ticketId provided, create ticket lines + prices
  let ticketLinesCreated = 0;
  let ticketLinesPriced = 0;

  if (ticketId) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, payingCustomerId: true },
    });
    if (!ticket) {
      return Response.json({ error: "ticket not found" }, { status: 404 });
    }

    // Find or create BES supplier
    let supplier = await prisma.supplier.findFirst({
      where: { name: { contains: "BES", mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: "BES" },
      });
    }

    for (const product of result.found) {
      const qty = qtyMap.get(product.besCode) ?? 1;

      // Check if a line with this BES code already exists on the ticket
      let line = await prisma.ticketLine.findFirst({
        where: {
          ticketId,
          OR: [
            { productCode: product.besCode },
            { description: { contains: product.besCode } },
          ],
        },
        select: { id: true, qty: true },
      });

      if (!line) {
        // Create new ticket line
        line = await prisma.ticketLine.create({
          data: {
            ticketId,
            lineType: "MATERIAL",
            description: product.name,
            productCode: product.besCode,
            qty,
            unit: "EA",
            payingCustomerId: ticket.payingCustomerId,
            status: "CAPTURED",
            supplierName: supplier.name,
            supplierId: supplier.id,
          },
        });
        ticketLinesCreated++;
      }

      // Check if BES price already exists for this line
      const existingPrice = await prisma.ticketLinePrice.findFirst({
        where: { ticketLineId: line.id, supplierName: supplier.name },
      });

      if (!existingPrice) {
        const costTotal = Math.round(product.priceExVat * qty * 100) / 100;

        await prisma.ticketLinePrice.create({
          data: {
            ticketLineId: line.id,
            supplierName: supplier.name,
            supplierId: supplier.id,
            costPerUnit: product.priceExVat,
            costTotal,
            notes: `BES code ${product.besCode} | ${product.inStock ? "In stock" : "Out of stock"} | ${product.productUrl}`,
          },
        });

        // Recalculate winner
        const prices = await prisma.ticketLinePrice.findMany({
          where: { ticketLineId: line.id },
          orderBy: { costTotal: "asc" },
        });
        const manual = prices.find((p) => p.isManual);
        const winner = manual ?? prices[0];
        if (winner) {
          await prisma.ticketLinePrice.updateMany({
            where: { ticketLineId: line.id, isWinner: true },
            data: { isWinner: false },
          });
          await prisma.ticketLinePrice.update({
            where: { id: winner.id },
            data: { isWinner: true },
          });
          await prisma.ticketLine.update({
            where: { id: line.id },
            data: {
              expectedCostUnit: winner.costPerUnit,
              expectedCostTotal: winner.costTotal,
              supplierName: winner.supplierName,
              supplierId: winner.supplierId,
            },
          });
        }

        ticketLinesPriced++;
      }
    }
  }

  return Response.json({
    products: result.found.map((p) => ({
      besCode: p.besCode,
      name: p.name,
      priceExVat: p.priceExVat,
      priceIncVat: p.priceIncVat,
      inStock: p.inStock,
      qty: qtyMap.get(p.besCode) ?? 1,
      lineTotal: Math.round(p.priceExVat * (qtyMap.get(p.besCode) ?? 1) * 100) / 100,
      productUrl: p.productUrl,
    })),
    notFound: result.notFound,
    errors: result.errors,
    summary: {
      totalCodes: items.length,
      found: result.found.length,
      notFound: result.notFound.length,
      errors: result.errors.length,
      totalExVat: Math.round(result.found.reduce((s, p) => s + p.priceExVat * (qtyMap.get(p.besCode) ?? 1), 0) * 100) / 100,
    },
    ...(ticketId ? { ticketLinesCreated, ticketLinesPriced } : {}),
  });
}

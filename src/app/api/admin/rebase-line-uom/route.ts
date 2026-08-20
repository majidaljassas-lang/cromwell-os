/**
 * Rebase a TicketLine's unit-of-measure across all downstream artefacts.
 * Use case: an item recorded as "76mm 6M Copper Tube" is actually being
 * supplied as 3M lengths; we want to double the qty and halve the unit price
 * so the line value stays identical. The change has to propagate to every
 * record that references the TicketLine, otherwise the PO / invoice / drawdown
 * numbers diverge.
 *
 * Body: {
 *   items: [{
 *     ticketLineId: string;
 *     qtyFactor: number;       // 2 = double qty
 *     priceFactor: number;     // 0.5 = halve price
 *     newDescription?: string; // optional, e.g. "76mm x 3M Copper Tube..."
 *   }]
 * }
 *
 * Per item, in one transaction:
 *   - TicketLine.qty *= qtyFactor; actualSaleUnit *= priceFactor; totals preserved
 *   - QuoteLine.qty *= qtyFactor; unitPrice *= priceFactor; lineTotal preserved
 *   - CustomerPOLine.qty *= qtyFactor; agreedUnitPrice *= priceFactor; agreedTotal preserved
 *   - SalesInvoiceLine.qty *= qtyFactor; unitPrice *= priceFactor; lineTotal preserved
 *   - MaterialsDrawdownEntry.qty *= qtyFactor; unitSell *= priceFactor; sellValue preserved
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

type Item = {
  ticketLineId: string;
  qtyFactor: number;
  priceFactor: number;
  newDescription?: string;
};

export async function POST(request: Request) {
  let body: { items?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items: Item[] = Array.isArray(body.items)
    ? body.items.flatMap((i) => {
        if (!i || typeof i !== "object") return [];
        const ii = i as Record<string, unknown>;
        if (typeof ii.ticketLineId !== "string") return [];
        const qf = Number(ii.qtyFactor);
        const pf = Number(ii.priceFactor);
        if (!Number.isFinite(qf) || qf <= 0) return [];
        if (!Number.isFinite(pf) || pf <= 0) return [];
        const newDescription =
          typeof ii.newDescription === "string" ? ii.newDescription : undefined;
        return [{ ticketLineId: ii.ticketLineId, qtyFactor: qf, priceFactor: pf, newDescription }];
      })
    : [];

  if (items.length === 0) {
    return Response.json({ error: "items is required" }, { status: 400 });
  }

  const summary: Array<Record<string, unknown>> = [];

  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      const tl = await tx.ticketLine.findUnique({ where: { id: it.ticketLineId } });
      if (!tl) throw new Error(`TicketLine not found: ${it.ticketLineId}`);

      const qf = new Prisma.Decimal(it.qtyFactor);
      const pf = new Prisma.Decimal(it.priceFactor);
      const newQty = new Prisma.Decimal(tl.qty).mul(qf);
      const newSaleUnit = tl.actualSaleUnit
        ? new Prisma.Decimal(tl.actualSaleUnit).mul(pf)
        : null;

      await tx.ticketLine.update({
        where: { id: it.ticketLineId },
        data: {
          qty: newQty,
          actualSaleUnit: newSaleUnit ?? undefined,
          // actualSaleTotal preserved
          description: it.newDescription ?? tl.description,
        },
      });

      const quoteLines = await tx.quoteLine.findMany({ where: { ticketLineId: it.ticketLineId } });
      for (const ql of quoteLines) {
        await tx.quoteLine.update({
          where: { id: ql.id },
          data: {
            qty: new Prisma.Decimal(ql.qty).mul(qf),
            unitPrice: new Prisma.Decimal(ql.unitPrice).mul(pf),
            // lineTotal preserved
            description: it.newDescription ?? ql.description,
          },
        });
      }

      const poLines = await tx.customerPOLine.findMany({ where: { ticketLineId: it.ticketLineId } });
      for (const pl of poLines) {
        await tx.customerPOLine.update({
          where: { id: pl.id },
          data: {
            qty: pl.qty !== null ? new Prisma.Decimal(pl.qty).mul(qf) : undefined,
            agreedUnitPrice:
              pl.agreedUnitPrice !== null ? new Prisma.Decimal(pl.agreedUnitPrice).mul(pf) : undefined,
            // agreedTotal preserved
            description: it.newDescription ?? pl.description,
          },
        });
      }

      const invLines = await tx.salesInvoiceLine.findMany({ where: { ticketLineId: it.ticketLineId } });
      for (const il of invLines) {
        await tx.salesInvoiceLine.update({
          where: { id: il.id },
          data: {
            qty: new Prisma.Decimal(il.qty).mul(qf),
            unitPrice: new Prisma.Decimal(il.unitPrice).mul(pf),
            // lineTotal preserved
            description: it.newDescription ?? il.description,
          },
        });
      }

      const drawdowns = await tx.materialsDrawdownEntry.findMany({
        where: { ticketLineId: it.ticketLineId },
      });
      for (const dd of drawdowns) {
        await tx.materialsDrawdownEntry.update({
          where: { id: dd.id },
          data: {
            qty: dd.qty ? new Prisma.Decimal(dd.qty).mul(qf) : undefined,
            unitSell: dd.unitSell ? new Prisma.Decimal(dd.unitSell).mul(pf) : undefined,
            // sellValue preserved
            description: it.newDescription ?? dd.description,
          },
        });
      }

      summary.push({
        ticketLineId: it.ticketLineId,
        before: { qty: Number(tl.qty), unit: tl.actualSaleUnit ? Number(tl.actualSaleUnit) : null },
        after: { qty: Number(newQty), unit: newSaleUnit ? Number(newSaleUnit) : null },
        propagated: {
          quoteLines: quoteLines.length,
          poLines: poLines.length,
          invoiceLines: invLines.length,
          drawdowns: drawdowns.length,
        },
      });
    }
  });

  return Response.json({ ok: true, items: summary });
}

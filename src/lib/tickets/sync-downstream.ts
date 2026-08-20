import { Prisma } from "@/generated/prisma";
import { STANDARD_VAT_RATE, lineVat } from "@/lib/finance/invoice-totals";

/**
 * Resync every DRAFT downstream artifact (SalesInvoice, Quote) attached to
 * `ticketId` from the current TicketLine source-of-truth. Non-DRAFT artifacts
 * (sent invoices, accepted quotes, paid invoices) are immutable history and
 * are never touched.
 *
 * Quotes: full rebuild from ALL ticket lines (one ticket = one quote scope).
 *
 * Invoices: scope-preserving sync. Invoices are PO-scoped — one ticket can
 * carry many POs, each invoiced separately — so the resync NEVER adds ticket
 * lines the invoice doesn't already carry. It only refreshes the lines the
 * invoice has (description/qty/price from their TicketLine) and removes lines
 * whose TicketLine was deleted or unpriced. Line order on the invoice is
 * never changed.
 *
 * Quote output order = ticket order, with BOM children interleaved
 * immediately after their parent. Parents carry the price; children render
 * at £0 ("Included") so totals are not double-counted.
 */

type TxLike = Prisma.TransactionClient | typeof import("@/lib/prisma").prisma;

const r2 = (n: number) => Math.round(n * 100) / 100;

const DRAFT_INVOICE_STATUS = "DRAFT";
const DRAFT_QUOTE_STATUS = "DRAFT";

type SourceLine = {
  id: string;
  description: string;
  qty: Prisma.Decimal;
  actualSaleUnit: Prisma.Decimal | null;
  suggestedSaleUnit: Prisma.Decimal | null;
  displayOrder: number;
  sectionLabel: string | null;
  parentLineId: string | null;
};

/** Return ticket lines in render order: each parent, then its children (by displayOrder, id).
 * Children whose parent is missing from the scope are treated as top-level so they still
 * get a unique slot — never silently dropped. */
function buildRenderOrder(all: SourceLine[]): Array<{ line: SourceLine; isBomChild: boolean; rank: number }> {
  const idsInScope = new Set(all.map((l) => l.id));
  const childrenByParent = new Map<string, SourceLine[]>();
  const orphans: SourceLine[] = [];
  for (const l of all) {
    if (l.parentLineId) {
      if (idsInScope.has(l.parentLineId)) {
        const arr = childrenByParent.get(l.parentLineId) ?? [];
        arr.push(l);
        childrenByParent.set(l.parentLineId, arr);
      } else {
        orphans.push(l);
      }
    }
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  }
  const topLines = all
    .filter((l) => l.parentLineId == null)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  const out: Array<{ line: SourceLine; isBomChild: boolean; rank: number }> = [];
  let rank = 0;
  for (const p of topLines) {
    out.push({ line: p, isBomChild: false, rank: ++rank });
    for (const k of childrenByParent.get(p.id) ?? []) {
      out.push({ line: k, isBomChild: true, rank: ++rank });
    }
  }
  orphans.sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  for (const o of orphans) out.push({ line: o, isBomChild: false, rank: ++rank });
  return out;
}

export async function resyncTicketDownstream(
  ticketId: string,
  client: TxLike,
): Promise<{ invoicesUpdated: number; quotesUpdated: number }> {
  const allTicketLines = await client.ticketLine.findMany({
    where: { ticketId },
    select: {
      id: true,
      description: true,
      qty: true,
      actualSaleUnit: true,
      suggestedSaleUnit: true,
      displayOrder: true,
      sectionLabel: true,
      parentLineId: true,
    },
  });
  const ordered = buildRenderOrder(allTicketLines);

  let invoicesUpdated = 0;
  let quotesUpdated = 0;

  const invoices = await client.salesInvoice.findMany({
    where: { ticketId, status: DRAFT_INVOICE_STATUS },
    select: { id: true, lines: { select: { id: true, ticketLineId: true } } },
  });
  for (const inv of invoices) {
    await rebuildInvoice(client, inv.id, ordered, inv.lines);
    invoicesUpdated++;
  }

  const quotes = await client.quote.findMany({
    where: { ticketId, status: DRAFT_QUOTE_STATUS },
    select: { id: true, lines: { select: { id: true, ticketLineId: true } } },
  });
  for (const q of quotes) {
    await rebuildQuote(client, q.id, ordered, q.lines);
    quotesUpdated++;
  }

  return { invoicesUpdated, quotesUpdated };
}

async function rebuildInvoice(
  client: TxLike,
  invoiceId: string,
  ordered: Array<{ line: SourceLine; isBomChild: boolean; rank: number }>,
  existing: { id: string; ticketLineId: string }[],
) {
  // Scope-preserving: only the lines already on the invoice are touched.
  // Never add ticket lines — invoices are PO-scoped and one ticket can
  // carry many POs. Never change displayOrder — invoice line order is set
  // at build time and is immutable.
  const sourceById = new Map(ordered.map((o) => [o.line.id, o]));
  let totalNet = 0;

  for (const ex of existing) {
    const src = sourceById.get(ex.ticketLineId);
    if (!src) {
      // TicketLine deleted — drop the invoice line.
      await client.salesInvoiceLine.delete({ where: { id: ex.id } });
      continue;
    }
    const { line: tl, isBomChild } = src;
    const unitPrice = isBomChild ? 0 : Number(tl.actualSaleUnit ?? tl.suggestedSaleUnit ?? 0);
    if (!isBomChild && unitPrice <= 0) {
      // Top-level line with no price — drop from invoice (don't bill £0
      // unless it's a deliberate FOC that already has a row).
      await client.salesInvoiceLine.delete({ where: { id: ex.id } });
      continue;
    }
    const qty = Number(tl.qty);
    const lineTotal = isBomChild ? 0 : r2(unitPrice * qty);
    if (!isBomChild) totalNet += lineTotal;
    await client.salesInvoiceLine.update({
      where: { id: ex.id },
      data: {
        description: tl.description,
        qty,
        unitPrice,
        lineTotal,
        vatRate: STANDARD_VAT_RATE,
        vatAmount: lineVat(lineTotal),
        displayMode: isBomChild ? "BOM_CHILD" : "LINE",
      },
    });
  }

  const totalNetR = r2(totalNet);
  const totalVat = lineVat(totalNetR);
  const totalGross = r2(totalNetR + totalVat);
  await client.salesInvoice.update({
    where: { id: invoiceId },
    data: { totalNet: totalNetR, totalVat, totalGross, totalSell: totalGross },
  });
}

async function rebuildQuote(
  client: TxLike,
  quoteId: string,
  ordered: Array<{ line: SourceLine; isBomChild: boolean; rank: number }>,
  existing: { id: string; ticketLineId: string }[],
) {
  const existingByTL = new Map(existing.map((e) => [e.ticketLineId, e.id]));
  const sourceIds = new Set(ordered.map((o) => o.line.id));
  let totalSell = 0;

  for (const { line: tl, isBomChild, rank } of ordered) {
    const unitPrice = isBomChild ? 0 : Number(tl.actualSaleUnit ?? tl.suggestedSaleUnit ?? 0);
    if (!isBomChild && unitPrice <= 0) {
      const existingId = existingByTL.get(tl.id);
      if (existingId) await client.quoteLine.delete({ where: { id: existingId } });
      continue;
    }
    const qty = Number(tl.qty);
    const lineTotal = isBomChild ? 0 : r2(unitPrice * qty);
    if (!isBomChild) totalSell += lineTotal;
    const data = {
      description: tl.description,
      sectionLabel: tl.sectionLabel,
      sortOrder: rank,
      qty,
      unitPrice,
      lineTotal,
    };
    const existingId = existingByTL.get(tl.id);
    if (existingId) {
      await client.quoteLine.update({ where: { id: existingId }, data });
    } else {
      await client.quoteLine.create({
        data: { ...data, quoteId, ticketLineId: tl.id },
      });
    }
  }

  for (const ex of existing) {
    if (!sourceIds.has(ex.ticketLineId)) {
      await client.quoteLine.delete({ where: { id: ex.id } });
    }
  }

  await client.quote.update({ where: { id: quoteId }, data: { totalSell: r2(totalSell) } });
}

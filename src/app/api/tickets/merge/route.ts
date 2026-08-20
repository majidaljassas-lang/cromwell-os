/**
 * Combine multiple tickets into a single new ticket and quote.
 *
 * Use case: two QUOTED tickets for the same customer + site need to become
 * one combined order at an agreed total (e.g. £32,250 ex VAT). All TicketLines
 * are copied to the new ticket; a single new Quote is created whose lines are
 * rescaled so the total matches the agreed value. Source tickets are CLOSED.
 *
 * Body: {
 *   sourceTicketIds: string[];        // 2+ ticket ids, same customer + site
 *   title: string;                    // title for the new combined ticket
 *   finalTotalExVat?: number;         // if set, line prices are scaled so sum = this
 * }
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

type MergeBody = {
  sourceTicketIds?: unknown;
  title?: unknown;
  finalTotalExVat?: unknown;
  orderedLineIds?: unknown;
};

export async function POST(request: Request) {
  let body: MergeBody;
  try {
    body = (await request.json()) as MergeBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sourceIds = Array.isArray(body.sourceTicketIds)
    ? (body.sourceTicketIds.filter((x) => typeof x === "string") as string[])
    : [];
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const finalTotalExVat =
    typeof body.finalTotalExVat === "number" && body.finalTotalExVat > 0
      ? body.finalTotalExVat
      : null;
  const orderedLineIds = Array.isArray(body.orderedLineIds)
    ? (body.orderedLineIds.filter((x) => typeof x === "string") as string[])
    : null;

  if (sourceIds.length < 2) {
    return Response.json({ error: "At least two sourceTicketIds required" }, { status: 400 });
  }
  if (!title) {
    return Response.json({ error: "title is required" }, { status: 400 });
  }

  const sourceTickets = await prisma.ticket.findMany({
    where: { id: { in: sourceIds } },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      payingCustomerId: true,
      siteId: true,
      siteCommercialLinkId: true,
      ticketMode: true,
      status: true,
    },
  });

  if (sourceTickets.length !== sourceIds.length) {
    return Response.json(
      { error: "One or more source tickets not found" },
      { status: 404 }
    );
  }

  const customerIds = new Set(sourceTickets.map((t) => t.payingCustomerId));
  const siteIds = new Set(sourceTickets.map((t) => t.siteId).filter(Boolean));
  if (customerIds.size > 1) {
    return Response.json(
      { error: "Source tickets have different customers — cannot merge" },
      { status: 400 }
    );
  }
  if (siteIds.size > 1) {
    return Response.json(
      { error: "Source tickets have different sites — cannot merge" },
      { status: 400 }
    );
  }

  const customerId = sourceTickets[0].payingCustomerId;
  const siteId = sourceTickets[0].siteId ?? null;
  const siteCommercialLinkId = sourceTickets[0].siteCommercialLinkId ?? null;

  const fetchedLines = await prisma.ticketLine.findMany({
    where: { ticketId: { in: sourceIds } },
    orderBy: [{ ticketId: "asc" }, { createdAt: "asc" }],
  });

  if (fetchedLines.length === 0) {
    return Response.json({ error: "Source tickets have no lines" }, { status: 400 });
  }

  // If caller supplied an explicit order, honour it. The list must reference
  // exactly the lines that exist on the source tickets — anything else is a
  // mismatch that we surface rather than silently drop or duplicate.
  let sourceLines: typeof fetchedLines;
  if (orderedLineIds) {
    const byId = new Map(fetchedLines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const ordered: typeof fetchedLines = [];
    for (const id of orderedLineIds) {
      if (seen.has(id)) {
        return Response.json({ error: `Duplicate id in orderedLineIds: ${id}` }, { status: 400 });
      }
      seen.add(id);
      const line = byId.get(id);
      if (!line) {
        return Response.json(
          { error: `orderedLineIds contains id not on any source ticket: ${id}` },
          { status: 400 }
        );
      }
      ordered.push(line);
    }
    if (ordered.length !== fetchedLines.length) {
      const missing = fetchedLines.filter((l) => !seen.has(l.id)).map((l) => l.id);
      return Response.json(
        { error: "orderedLineIds is missing source-ticket lines", missing },
        { status: 400 }
      );
    }
    sourceLines = ordered;
  } else {
    sourceLines = fetchedLines;
  }

  // Pick the latest quote per source ticket to lift unit prices from
  const sourceQuotes = await prisma.quote.findMany({
    where: { ticketId: { in: sourceIds } },
    include: { lines: true },
    orderBy: { createdAt: "desc" },
  });
  const latestQuoteByTicket = new Map<string, (typeof sourceQuotes)[number]>();
  for (const q of sourceQuotes) {
    if (!latestQuoteByTicket.has(q.ticketId)) latestQuoteByTicket.set(q.ticketId, q);
  }
  const quoteLineByTicketLine = new Map<string, (typeof sourceQuotes)[number]["lines"][number]>();
  for (const q of latestQuoteByTicket.values()) {
    for (const ql of q.lines) quoteLineByTicketLine.set(ql.ticketLineId, ql);
  }

  // Compute current total from quote lines (fallback to ticket-line suggested/actual sale)
  function priceForLine(line: (typeof sourceLines)[number]): {
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  } {
    const ql = quoteLineByTicketLine.get(line.id);
    if (ql) {
      return { unitPrice: ql.unitPrice, lineTotal: ql.lineTotal };
    }
    const unit =
      line.actualSaleUnit ??
      line.suggestedSaleUnit ??
      new Prisma.Decimal(0);
    const total = new Prisma.Decimal(unit).mul(line.qty);
    return { unitPrice: new Prisma.Decimal(unit), lineTotal: total };
  }

  let currentTotal = new Prisma.Decimal(0);
  const provisionalLines = sourceLines.map((line) => {
    const p = priceForLine(line);
    currentTotal = currentTotal.add(p.lineTotal);
    return { line, ...p };
  });

  let scaleFactor = new Prisma.Decimal(1);
  if (finalTotalExVat !== null) {
    if (currentTotal.lte(0)) {
      // No existing prices — distribute final total evenly across lines by qty share
      // Use qty share so heavier lines get more value.
      const totalQty = sourceLines.reduce(
        (acc, l) => acc.add(l.qty),
        new Prisma.Decimal(0)
      );
      if (totalQty.lte(0)) {
        return Response.json(
          { error: "Cannot rescale: no existing prices and zero total qty" },
          { status: 400 }
        );
      }
      // Synthesise unit prices so per-line total = finalTotal * (qty / totalQty)
      const target = new Prisma.Decimal(finalTotalExVat);
      for (const p of provisionalLines) {
        const share = target.mul(p.line.qty).div(totalQty);
        const unit = p.line.qty.gt(0) ? share.div(p.line.qty) : new Prisma.Decimal(0);
        p.unitPrice = unit;
        p.lineTotal = share;
      }
      currentTotal = target;
    } else {
      scaleFactor = new Prisma.Decimal(finalTotalExVat).div(currentTotal);
      for (const p of provisionalLines) {
        p.unitPrice = p.unitPrice.mul(scaleFactor);
        p.lineTotal = p.lineTotal.mul(scaleFactor);
      }
    }
  }

  // Re-sum after rescale and adjust the last line so totals match exactly
  // (Decimal multiplication can leave a 1p drift).
  if (finalTotalExVat !== null && provisionalLines.length > 0) {
    const target = new Prisma.Decimal(finalTotalExVat).toDecimalPlaces(2);
    const summed = provisionalLines.reduce(
      (acc, p) => acc.add(p.lineTotal.toDecimalPlaces(2)),
      new Prisma.Decimal(0)
    );
    const drift = target.minus(summed);
    if (!drift.isZero()) {
      const last = provisionalLines[provisionalLines.length - 1];
      last.lineTotal = last.lineTotal.add(drift);
      if (last.line.qty.gt(0)) {
        last.unitPrice = last.lineTotal.div(last.line.qty);
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Create the combined ticket
    const newTicket = await tx.ticket.create({
      data: {
        title,
        payingCustomerId: customerId,
        siteId: siteId ?? undefined,
        siteCommercialLinkId: siteCommercialLinkId ?? undefined,
        ticketMode: "DIRECT_ORDER",
        status: "QUOTED",
        revenueState: "OPERATIONAL",
        description:
          `Combined from tickets: ${sourceTickets
            .map((t) => `CP-${String(t.ticketNo).padStart(4, "0")}`)
            .join(", ")}`,
      },
    });

    // Copy ticket lines, mapping old → new
    const lineIdMap = new Map<string, string>();
    for (const line of sourceLines) {
      const created = await tx.ticketLine.create({
        data: {
          ticketId: newTicket.id,
          lineType: line.lineType,
          description: line.description,
          normalizedItemName: line.normalizedItemName ?? undefined,
          productCode: line.productCode ?? undefined,
          specification: line.specification ?? undefined,
          qty: line.qty,
          unit: line.unit,
          siteId: line.siteId ?? undefined,
          siteCommercialLinkId: line.siteCommercialLinkId ?? undefined,
          payingCustomerId: line.payingCustomerId,
          requestedByContactId: line.requestedByContactId ?? undefined,
          supplierStrategyType: line.supplierStrategyType ?? undefined,
          supplierId: line.supplierId ?? undefined,
          supplierName: line.supplierName ?? undefined,
          supplierReference: line.supplierReference ?? undefined,
          // Carry costs forward — without these the merged ticket has no P&L
          expectedCostUnit: line.expectedCostUnit ?? undefined,
          expectedCostTotal: line.expectedCostTotal ?? undefined,
          status: "READY_FOR_QUOTE",
          sourceItemIds: [line.id],
          sectionLabel: line.sectionLabel ?? undefined,
          canonicalProductId: line.canonicalProductId ?? undefined,
        },
      });
      lineIdMap.set(line.id, created.id);
    }

    // Create the combined quote
    const finalTotal = finalTotalExVat ?? Number(currentTotal.toFixed(2));
    const quoteNo = `CP-${newTicket.ticketNo}-Q1`;
    const newQuote = await tx.quote.create({
      data: {
        ticketId: newTicket.id,
        quoteNo,
        versionNo: 1,
        quoteType: "STANDARD",
        customerId,
        siteId: siteId ?? undefined,
        siteCommercialLinkId: siteCommercialLinkId ?? undefined,
        status: "APPROVED",
        issuedAt: new Date(),
        totalSell: new Prisma.Decimal(finalTotal),
        notes:
          `Combined quote from ${sourceTickets
            .map((t) => `CP-${String(t.ticketNo).padStart(4, "0")}`)
            .join(", ")}` +
          (finalTotalExVat !== null
            ? `. Lines rescaled to agreed total of £${finalTotalExVat.toFixed(2)} ex VAT.`
            : ""),
      },
    });

    // Create quote lines mirroring ticket lines with rescaled prices
    let sortOrder = 0;
    for (const p of provisionalLines) {
      const newTicketLineId = lineIdMap.get(p.line.id)!;
      await tx.quoteLine.create({
        data: {
          quoteId: newQuote.id,
          ticketLineId: newTicketLineId,
          description: p.line.description,
          sectionLabel: p.line.sectionLabel ?? undefined,
          sortOrder: sortOrder++,
          qty: p.line.qty,
          unitPrice: p.unitPrice.toDecimalPlaces(4),
          lineTotal: p.lineTotal.toDecimalPlaces(2),
        },
      });
      // Also write the agreed sale price back onto the new TicketLine so the
      // ticket totals reflect the merged value.
      await tx.ticketLine.update({
        where: { id: newTicketLineId },
        data: {
          actualSaleUnit: p.unitPrice.toDecimalPlaces(4),
          actualSaleTotal: p.lineTotal.toDecimalPlaces(2),
        },
      });
    }

    // Close source tickets
    await tx.ticket.updateMany({
      where: { id: { in: sourceIds } },
      data: { status: "CLOSED" },
    });

    return { newTicketId: newTicket.id, newTicketNo: newTicket.ticketNo, newQuoteId: newQuote.id, finalTotal };
  });

  return Response.json({
    ok: true,
    ticketId: result.newTicketId,
    ticketNo: result.newTicketNo,
    quoteId: result.newQuoteId,
    totalExVat: result.finalTotal,
    linesCopied: sourceLines.length,
    sourceTicketIds: sourceIds,
  });
}

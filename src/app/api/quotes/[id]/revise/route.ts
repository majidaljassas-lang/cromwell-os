import { prisma } from "@/lib/prisma";

/**
 * POST /api/quotes/[id]/revise
 *
 * Freeze current quote as SUPERSEDED, clone as new version with changes.
 * Both versions visible in the Quotes tab.
 *
 * Body: { reason?: string, affectedLineIds: string[], replacements?: Record<quoteLineId, { description, qty, cost, sale }> }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { reason, affectedLineIds, replacements } = await request.json();

    const reasonText = reason?.trim() || "Lines revised";

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lines: { include: { ticketLine: { select: { id: true, description: true, qty: true } } } },
      },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    const oldVersion = quote.versionNo;
    const newVersion = oldVersion + 1;

    // Identify affected quote lines
    const affectedQuoteLines = affectedLineIds?.length
      ? quote.lines.filter((l) => affectedLineIds.includes(l.id))
      : [];

    // Build event notes
    let notes = `Quote ${quote.quoteNo} revised (v${oldVersion} → v${newVersion}): ${reasonText}`;
    if (affectedQuoteLines.length > 0) {
      notes += `\nAffected items: ${affectedQuoteLines.map((l) => l.description).join(", ")}`;
    }

    // === 1. Freeze current quote as SUPERSEDED ===
    await prisma.quote.update({
      where: { id },
      data: { status: "SUPERSEDED" },
    });

    // === 2. Clone as new quote with bumped version ===
    const newQuote = await prisma.quote.create({
      data: {
        ticketId: quote.ticketId,
        ticketPhaseId: quote.ticketPhaseId,
        quoteNo: quote.quoteNo,
        versionNo: newVersion,
        quoteType: quote.quoteType,
        customerId: quote.customerId,
        siteId: quote.siteId,
        siteCommercialLinkId: quote.siteCommercialLinkId,
        status: "DRAFT",
        notes: quote.notes,
        totalSell: quote.totalSell,
      },
    });

    // === 3. Clone all lines, applying replacements to affected ones ===
    let newTotalSell = 0;
    for (const ql of quote.lines) {
      const rep = replacements?.[ql.id];
      const isAffected = affectedLineIds?.includes(ql.id);

      const desc = (isAffected && rep?.description) ? rep.description : ql.description;
      const qty = (isAffected && rep?.qty) ? Number(rep.qty) : Number(ql.qty);
      const unitPrice = (isAffected && rep?.sale) ? Number(rep.sale) : Number(ql.unitPrice);
      const lineTotal = qty * unitPrice;

      await prisma.quoteLine.create({
        data: {
          quoteId: newQuote.id,
          ticketLineId: ql.ticketLineId,
          description: desc,
          qty,
          unitPrice,
          lineTotal,
        },
      });

      newTotalSell += lineTotal;

      // If affected, also update the ticket line
      if (isAffected && rep) {
        const ticketLineId = ql.ticketLine?.id;
        if (ticketLineId) {
          const updateData: Record<string, unknown> = { status: "READY_FOR_QUOTE" };
          if (rep.description) updateData.description = rep.description;
          if (rep.qty) updateData.qty = Number(rep.qty);
          if (rep.cost) {
            updateData.expectedCostUnit = Number(rep.cost);
            updateData.expectedCostTotal = Number(rep.cost) * qty;
          }
          if (rep.sale) {
            updateData.actualSaleUnit = Number(rep.sale);
            updateData.actualSaleTotal = Number(rep.sale) * qty;
          }
          await prisma.ticketLine.update({ where: { id: ticketLineId }, data: updateData });

          // Add change detail to notes
          if (rep.description) {
            notes += `\n• ${ql.description} → ${rep.description}`;
          }
        }
      }
    }

    // Update new quote total
    await prisma.quote.update({
      where: { id: newQuote.id },
      data: { totalSell: newTotalSell },
    });

    // === 4. Void any DRAFT invoices on this ticket (pricing has changed) ===
    const draftInvoices = await prisma.salesInvoice.findMany({
      where: { ticketId: quote.ticketId, status: "DRAFT" },
      select: { id: true, invoiceNo: true },
    });

    if (draftInvoices.length > 0) {
      await prisma.salesInvoice.updateMany({
        where: { ticketId: quote.ticketId, status: "DRAFT" },
        data: { status: "VOIDED" },
      });

      const voidedNos = draftInvoices.map(i => i.invoiceNo || i.id).join(", ");
      notes += `\n⚠ Auto-voided ${draftInvoices.length} draft invoice(s): ${voidedNos} (pricing changed)`;

      await prisma.event.create({
        data: {
          ticketId: quote.ticketId,
          eventType: "INVOICE_VOIDED",
          timestamp: new Date(),
          notes: `Draft invoice(s) ${voidedNos} auto-voided — quote revised from v${oldVersion} to v${newVersion}, pricing no longer valid.`,
        },
      });
    }

    // === 5. Revert ticket status ===
    await prisma.ticket.update({
      where: { id: quote.ticketId },
      data: { status: "QUOTED" },
    });

    // === 6. Log event ===
    await prisma.event.create({
      data: {
        ticketId: quote.ticketId,
        eventType: "QUOTE_REVISED",
        timestamp: new Date(),
        notes,
      },
    });

    return Response.json({
      ok: true,
      quoteNo: quote.quoteNo,
      oldVersion,
      newVersion,
      oldQuoteId: id,
      newQuoteId: newQuote.id,
      affectedLines: affectedQuoteLines.length,
    }, { status: 200 });
  } catch (error) {
    console.error("Failed to revise quote:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to revise quote" }, { status: 500 });
  }
}

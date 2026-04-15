import { prisma } from "@/lib/prisma";

/**
 * POST /api/sales-invoices/[id]/match-po
 * Auto-match invoice lines to the linked Customer PO.
 *
 * Logic:
 * 1. Get the invoice, its poNo, customerId
 * 2. Find the matching CustomerPO (by poNo + customer family — parent or subsidiary)
 * 3. For each invoice line, try to match to a PO line by:
 *    a. Same ticketLineId (if PO line has one)
 *    b. Description token overlap
 * 4. If matched, set poMatched=true, poMatchStatus="MATCHED"
 * 5. If invoice has poNo but no PO found, set poMatchStatus="NO_PO_FOUND"
 * 6. Header-level fallback: if no line-level match but PO exists, mark all lines as MATCHED_HEADER
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        lines: { include: { ticketLine: true } },
        customer: true,
      },
    });

    if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });
    if (!invoice.poNo) return Response.json({ ok: true, message: "No PO on invoice — nothing to match", matched: 0 });

    // Build customer family (parent + subs) for cross-matching
    const customer = await prisma.customer.findUnique({
      where: { id: invoice.customerId },
      include: {
        parentEntity: { select: { id: true } },
        subsidiaries: { select: { id: true } },
      },
    });

    const familyIds = new Set<string>([invoice.customerId]);
    if (customer?.parentEntity?.id) {
      familyIds.add(customer.parentEntity.id);
      const siblings = await prisma.customer.findMany({
        where: { parentCustomerEntityId: customer.parentEntity.id },
        select: { id: true },
      });
      siblings.forEach(s => familyIds.add(s.id));
    }
    customer?.subsidiaries?.forEach(s => familyIds.add(s.id));

    // Find the CustomerPO (try exact poNo + family)
    const customerPO = await prisma.customerPO.findFirst({
      where: {
        poNo: invoice.poNo,
        customerId: { in: [...familyIds] },
      },
      include: { lines: { include: { ticketLine: true } } },
    });

    if (!customerPO) {
      await prisma.salesInvoiceLine.updateMany({
        where: { salesInvoiceId: id },
        data: { poMatched: false, poMatchStatus: "NO_PO_FOUND" },
      });
      return Response.json({ ok: true, message: "No matching CustomerPO found", matched: 0 });
    }

    // Header-only invoice (no lines but PO matched) — record on invoice notes
    if (invoice.lines.length === 0) {
      const existingNotes = invoice.notes || "";
      const headerMatchTag = "[PO_MATCHED_HEADER]";
      const newNotes = existingNotes.includes(headerMatchTag)
        ? existingNotes
        : (existingNotes + (existingNotes ? " " : "") + headerMatchTag).trim();
      await prisma.salesInvoice.update({
        where: { id },
        data: { notes: newNotes },
      });
      return Response.json({
        ok: true,
        poFound: customerPO.poNo,
        message: "Invoice has no lines — marked as header-level PO match",
        headerOnly: true,
        total: 0,
      });
    }

    // Try to match each invoice line to a PO line
    function normalize(s: string): string[] {
      return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length > 2);
    }

    let matched = 0;
    let unmatched = 0;

    for (const invLine of invoice.lines) {
      let bestMatch: { id: string; score: number } | null = null;

      // Try: ticketLineId match (highest confidence)
      if (invLine.ticketLineId) {
        const poLine = customerPO.lines.find(pl => pl.ticketLineId === invLine.ticketLineId);
        if (poLine) bestMatch = { id: poLine.id, score: 100 };
      }

      // Try: description token overlap
      if (!bestMatch) {
        const invTokens = new Set(normalize(invLine.description));
        let bestScore = 0;
        let bestId: string | null = null;
        for (const poLine of customerPO.lines) {
          const poTokens = new Set(normalize(poLine.description));
          let overlap = 0;
          for (const t of invTokens) if (poTokens.has(t)) overlap++;
          const score = invTokens.size > 0 ? (overlap / invTokens.size) * 100 : 0;
          if (score > bestScore && score >= 50) {
            bestScore = score;
            bestId = poLine.id;
          }
        }
        if (bestId) bestMatch = { id: bestId, score: bestScore };
      }

      if (bestMatch) {
        await prisma.salesInvoiceLine.update({
          where: { id: invLine.id },
          data: {
            poMatched: true,
            poMatchStatus: bestMatch.score >= 70 ? "MATCHED" : "MATCHED_PARTIAL",
          },
        });
        matched++;
      } else {
        // Header fallback: PO exists, line not specifically matched, but covered by PO
        await prisma.salesInvoiceLine.update({
          where: { id: invLine.id },
          data: {
            poMatched: true,
            poMatchStatus: "MATCHED_HEADER",
          },
        });
        unmatched++;
      }
    }

    return Response.json({
      ok: true,
      poFound: customerPO.poNo,
      lineMatches: matched,
      headerMatches: unmatched,
      total: invoice.lines.length,
    });
  } catch (error) {
    console.error("PO match failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Match failed" }, { status: 500 });
  }
}

/**
 * POST /api/customer-pos/[id]/materials-drawdowns/build-invoice
 *
 * Build one SalesInvoice from selected LOGGED MaterialsDrawdownEntries on a PO.
 * Each entry becomes one SalesInvoiceLine that REFERENCES the entry's original
 * ticket line (no shadow-line cloning), with the approved quote number frozen
 * onto the line as `sourceRef` so it renders under the description. Entries are
 * marked INVOICED with their invoiceLineId.
 *
 * Body: { entryIds: string[]; notes?: string }
 * Output: { invoiceId, invoiceNo, totalSell, lineCount }
 */
import { prisma } from "@/lib/prisma";
import { STANDARD_VAT_RATE, lineVat, recomputeInvoiceTotals } from "@/lib/finance/invoice-totals";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      entryIds?: string[];
      notes?: string;
    };
    const entryIds = body.entryIds ?? [];
    if (entryIds.length === 0) {
      return Response.json({ error: "entryIds required" }, { status: 400 });
    }

    const po = await prisma.customerPO.findUnique({
      where: { id: poId },
      include: {
        customer: { select: { id: true, name: true } },
        site: { select: { id: true, siteName: true } },
      },
    });
    if (!po) return Response.json({ error: "PO not found" }, { status: 404 });
    if (!po.siteId) {
      return Response.json(
        { error: "PO has no site — assign one before invoicing" },
        { status: 422 }
      );
    }

    const found = await prisma.materialsDrawdownEntry.findMany({
      where: { id: { in: entryIds }, customerPOId: poId },
    });
    if (found.length === 0) {
      return Response.json({ error: "No matching entries found on this PO" }, { status: 404 });
    }
    const notLogged = found.filter((e) => e.status !== "LOGGED");
    if (notLogged.length > 0) {
      return Response.json(
        { error: `${notLogged.length} entr(y/ies) are not LOGGED (already invoiced?)` },
        { status: 400 }
      );
    }
    // Preserve the caller's line order (invoice lines are immutable in order).
    const byId = new Map(found.map((e) => [e.id, e]));
    const entries = entryIds.map((id) => byId.get(id)).filter((e): e is (typeof found)[number] => !!e);

    // Resolve each entry's approved quote number via its original ticket line.
    const tlIds = entries.map((e) => e.ticketLineId).filter((t): t is string => !!t);
    const quoteNoByTLine = new Map<string, string>();
    if (tlIds.length > 0) {
      const qls = await prisma.quoteLine.findMany({
        where: { ticketLineId: { in: tlIds } },
        select: { ticketLineId: true, quote: { select: { quoteNo: true, status: true, versionNo: true } } },
      });
      // Prefer the highest-version APPROVED quote per ticket line.
      const best = new Map<string, { quoteNo: string; status: string; versionNo: number }>();
      for (const ql of qls) {
        const cur = best.get(ql.ticketLineId);
        const cand = ql.quote;
        const better =
          !cur ||
          (cand.status === "APPROVED" && cur.status !== "APPROVED") ||
          (cand.status === cur.status && cand.versionNo > cur.versionNo);
        if (better) best.set(ql.ticketLineId, cand);
      }
      for (const [tl, q] of best) quoteNoByTLine.set(tl, q.quoteNo);
    }

    const totalSell = entries.reduce((s, e) => s + Number(e.sellValue ?? 0), 0);
    const ticketId = po.ticketId; // standing drawdown PO always has its base ticket
    if (!ticketId) {
      return Response.json(
        { error: "PO has no linked ticket — cannot invoice" },
        { status: 422 }
      );
    }

    const invoiceNo = `INV-${Date.now()}`;
    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.create({
        data: {
          ticketId,
          invoiceNo,
          customerId: po.customerId,
          siteId: po.siteId!,
          siteCommercialLinkId: po.siteCommercialLinkId || undefined,
          poNo: po.poNo,
          invoiceType: "STANDARD",
          status: "DRAFT",
          issuedAt,
          dueDate,
          totalSell,
          notes: body.notes ?? `Materials drawdown — PO ${po.poNo} — ${entries.length} line(s)`,
        },
      });

      let lineSeq = 0;
      for (const entry of entries) {
        lineSeq++;
        const qty = Number(entry.qty ?? 0);
        const unitPrice = Number(entry.unitSell ?? 0);
        const lineTotal = Number(entry.sellValue ?? 0);
        const quoteNo = entry.ticketLineId ? quoteNoByTLine.get(entry.ticketLineId) ?? null : null;

        // Reference the entry's original ticket line; only create one if the
        // entry was logged without a line (kept off the shadow-line path).
        let ticketLineId = entry.ticketLineId;
        if (!ticketLineId) {
          const tline = await tx.ticketLine.create({
            data: {
              ticketId,
              lineType: "MATERIAL",
              description: entry.description,
              qty,
              unit: "EA",
              expectedCostUnit: 0,
              actualSaleUnit: unitPrice,
              actualSaleTotal: lineTotal,
              payingCustomerId: po.customerId,
              siteId: po.siteId!,
              status: "INVOICED",
            },
          });
          ticketLineId = tline.id;
        }

        const sil = await tx.salesInvoiceLine.create({
          data: {
            salesInvoiceId: inv.id,
            ticketLineId,
            description: entry.description,
            qty,
            unitPrice,
            lineTotal,
            vatRate: STANDARD_VAT_RATE,
            vatAmount: lineVat(lineTotal),
            displayMode: "LINE",
            sourceRef: quoteNo,
            displayOrder: lineSeq,
            poMatched: true,
            poMatchStatus: "MATCHED",
          },
        });

        await tx.materialsDrawdownEntry.update({
          where: { id: entry.id },
          data: { status: "INVOICED", invoiceLineId: sil.id },
        });
      }

      await recomputeInvoiceTotals(tx, inv.id);
      return inv;
    });

    return Response.json(
      {
        ok: true,
        invoiceId: result.id,
        invoiceNo: result.invoiceNo,
        totalSell: Number(totalSell.toFixed(2)),
        lineCount: entries.length,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("/api/customer-pos/[id]/materials-drawdowns/build-invoice failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

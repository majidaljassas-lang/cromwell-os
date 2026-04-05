import { prisma } from "@/lib/prisma";
import { normalizeProduct, convertToBase } from "@/lib/reconciliation/normalizer";
import { canonicalizeSiteAsync, parseOrderRef } from "@/lib/reconciliation/site-aliases";

/**
 * POST: Ingest invoice lines for reconciliation.
 * Body: { caseId, invoices: Array<{ invoiceNumber, invoiceDate, customer?, site?,
 *   lines: Array<{ productDescription, qty, unit?, rate?, amount?, lineHeaderText? }> }> }
 *
 * BILL-LINK RULE:
 * - lineHeaderText = "Materials" → isBillLinked = true, invoiceLineType = "BILL_LINKED"
 * - anything else → isBillLinked = false, invoiceLineType = "MANUAL_INVOICE_LINE"
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { caseId, invoices } = body;

    if (!caseId || !invoices?.length) {
      return Response.json({ error: "caseId and invoices array required" }, { status: 400 });
    }

    let totalCreated = 0;

    for (const inv of invoices) {
      // Site aliasing — async lookup from database
      const { canonical: canonicalSite, aliasUsed: siteAliasUsed } = await canonicalizeSiteAsync(inv.site);

      // Order ref parsing
      const orderRef = parseOrderRef(inv.orderRef);

      for (const line of inv.lines) {
        const { normalized, confidence } = normalizeProduct(line.productDescription);
        const unit = line.unit || "EA";
        const qty = Number(line.qty || 0);
        const base = convertToBase(normalized, qty, unit);

        const isMaterials = (line.lineHeaderText || "").toLowerCase().includes("materials");
        const isBillLinked = isMaterials;
        const invoiceLineType = isBillLinked ? "BILL_LINKED" : "MANUAL_INVOICE_LINE";

        let billingConfidence = "LOW";
        if (isBillLinked && confidence >= 70) billingConfidence = "HIGH";
        else if (!isBillLinked && confidence >= 70) billingConfidence = "MEDIUM";
        else if (isBillLinked && confidence < 70) billingConfidence = "MEDIUM";

        await prisma.backlogInvoiceLine.create({
          data: {
            caseId,
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: new Date(inv.invoiceDate),
            customer: inv.customer,
            site: inv.site || "Dellow Centre",
            canonicalSite: canonicalSite,
            siteAliasUsed: siteAliasUsed,
            orderRefRaw: orderRef.raw,
            orderRefTokens: orderRef.tokens,
            orderRefDateHint: orderRef.dateHint,
            orderRefItemHint: orderRef.itemHint,
            productDescription: line.productDescription,
            normalizedProduct: normalized,
            qty,
            unit,
            qtyBase: base.qtyBase,
            baseUnit: base.baseUnit,
            rate: line.rate ? Number(line.rate) : undefined,
            amount: line.amount ? Number(line.amount) : undefined,
            lineHeaderText: line.lineHeaderText,
            isMaterialsHeader: isMaterials,
            isBillLinked,
            invoiceLineType,
            billingConfidence,
          },
        });
        totalCreated++;
      }
    }

    return Response.json({ created: totalCreated }, { status: 201 });
  } catch (error) {
    console.error("Invoice ingestion failed:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get("caseId");
    if (!caseId) return Response.json({ error: "caseId required" }, { status: 400 });

    const lines = await prisma.backlogInvoiceLine.findMany({
      where: { caseId },
      orderBy: { invoiceDate: "asc" },
    });
    return Response.json(lines);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

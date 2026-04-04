import { prisma } from "@/lib/prisma";

/**
 * GET: Reconciliation summary for a case.
 * Returns flat table + commercial summary.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  try {
    const ticketLines = await prisma.backlogTicketLine.findMany({
      where: { caseId },
      include: {
        invoiceMatches: {
          include: { invoiceLine: true },
        },
      },
      orderBy: { normalizedProduct: "asc" },
    });

    // Build reconciliation table
    const rows = ticketLines.map((tl) => {
      const invoicedQty = tl.invoiceMatches.reduce((s, m) => s + Number(m.invoiceLine.qty), 0);
      const requestedQty = Number(tl.requestedQty);
      const difference = invoicedQty - requestedQty;

      const invoicedAmount = tl.invoiceMatches.reduce((s, m) => s + Number(m.invoiceLine.amount || 0), 0);

      // Status
      let status: string;
      if (invoicedQty === 0) status = "NOT_INVOICED";
      else if (invoicedQty >= requestedQty) status = "COMPLETE";
      else if (invoicedQty > 0 && tl.invoiceMatches.length > 1) status = "PARTIAL";
      else status = "UNDERBILLED";

      // Invoice line types
      const billLinkedCount = tl.invoiceMatches.filter((m) => m.invoiceLine.isBillLinked).length;
      const manualCount = tl.invoiceMatches.filter((m) => !m.invoiceLine.isBillLinked).length;

      // Billing confidence — worst case across matches
      const confidences = tl.invoiceMatches.map((m) => m.invoiceLine.billingConfidence);
      const billingConfidence = confidences.includes("LOW") ? "LOW" : confidences.includes("MEDIUM") ? "MEDIUM" : confidences.length > 0 ? "HIGH" : "NONE";

      return {
        id: tl.id,
        product: tl.normalizedProduct,
        rawText: tl.rawText,
        sender: tl.sender,
        date: tl.date,
        requestedQty,
        requestedUnit: tl.requestedUnit,
        invoicedQty,
        difference,
        invoicedAmount,
        status,
        billLinkedCount,
        manualCount,
        invoiceLineType: billLinkedCount > 0 && manualCount === 0 ? "BILL_LINKED" : manualCount > 0 && billLinkedCount === 0 ? "MANUAL_INVOICE_LINE" : billLinkedCount > 0 ? "MIXED" : "NONE",
        billingConfidence,
        invoiceMatches: tl.invoiceMatches.map((m) => ({
          invoiceNumber: m.invoiceLine.invoiceNumber,
          qty: Number(m.invoiceLine.qty),
          amount: Number(m.invoiceLine.amount || 0),
          isBillLinked: m.invoiceLine.isBillLinked,
          invoiceLineType: m.invoiceLine.invoiceLineType,
          billingConfidence: m.invoiceLine.billingConfidence,
        })),
      };
    });

    // Unmatched invoice lines (invoiced but not linked to any ticket line)
    const allInvoiceLines = await prisma.backlogInvoiceLine.findMany({ where: { caseId } });
    const matchedInvoiceIds = new Set(ticketLines.flatMap((tl) => tl.invoiceMatches.map((m) => m.invoiceLineId)));
    const unmatchedInvoiceLines = allInvoiceLines.filter((il) => !matchedInvoiceIds.has(il.id));

    // Commercial summary
    const totalRequestedValue = rows.reduce((s, r) => s + r.invoicedAmount, 0); // approximate
    const totalInvoicedValue = allInvoiceLines.reduce((s, il) => s + Number(il.amount || 0), 0);
    const totalBillLinkedValue = allInvoiceLines.filter((il) => il.isBillLinked).reduce((s, il) => s + Number(il.amount || 0), 0);
    const totalManualValue = allInvoiceLines.filter((il) => !il.isBillLinked).reduce((s, il) => s + Number(il.amount || 0), 0);
    const totalUninvoicedLines = rows.filter((r) => r.status === "NOT_INVOICED").length;

    return Response.json({
      caseId,
      reconciliation: rows,
      unmatchedInvoiceLines: unmatchedInvoiceLines.map((il) => ({
        id: il.id,
        invoiceNumber: il.invoiceNumber,
        productDescription: il.productDescription,
        normalizedProduct: il.normalizedProduct,
        qty: Number(il.qty),
        amount: Number(il.amount || 0),
        isBillLinked: il.isBillLinked,
        invoiceLineType: il.invoiceLineType,
        billingConfidence: il.billingConfidence,
      })),
      summary: {
        totalTicketLines: ticketLines.length,
        totalInvoiceLines: allInvoiceLines.length,
        totalInvoicedValue: Math.round(totalInvoicedValue * 100) / 100,
        totalBillLinkedValue: Math.round(totalBillLinkedValue * 100) / 100,
        totalManualValue: Math.round(totalManualValue * 100) / 100,
        totalUninvoicedLines,
        statusCounts: {
          COMPLETE: rows.filter((r) => r.status === "COMPLETE").length,
          PARTIAL: rows.filter((r) => r.status === "PARTIAL").length,
          UNDERBILLED: rows.filter((r) => r.status === "UNDERBILLED").length,
          NOT_INVOICED: rows.filter((r) => r.status === "NOT_INVOICED").length,
        },
      },
    });
  } catch (error) {
    console.error("Reconciliation summary failed:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

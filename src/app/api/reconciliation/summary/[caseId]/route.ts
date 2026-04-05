import { prisma } from "@/lib/prisma";

/**
 * GET: Reconciliation summary — STRICT rules.
 *
 * ONLY shows data traceable to real sources:
 * - REQ from messages only
 * - INV from linked invoice lines only (0 if none linked)
 * - DIFF only calculated when invoice lines exist
 * - STATUS: MESSAGE_LINKED / AWAITING_INVOICE / INVOICE_LINKED / PARTIAL / COMPLETE / UNDERBILLED
 *
 * NO assumptions. NO placeholders. NO inferred values.
 */
export async function GET(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  try {
    const ticketLines = await prisma.backlogTicketLine.findMany({
      where: { caseId },
      include: {
        orderThread: { select: { id: true, label: true } },
        invoiceMatches: {
          include: { invoiceLine: true },
        },
      },
      orderBy: { normalizedProduct: "asc" },
    });

    const rows = ticketLines.map((tl) => {
      const hasInvoiceLinks = tl.invoiceMatches.length > 0;
      const invoicedQty = hasInvoiceLinks ? tl.invoiceMatches.reduce((s, m) => s + Number(m.invoiceLine.qty), 0) : 0;
      const invoicedAmount = hasInvoiceLinks ? tl.invoiceMatches.reduce((s, m) => s + Number(m.invoiceLine.amount || 0), 0) : 0;
      const requestedQty = Number(tl.requestedQty);

      // STRICT STATUS RULES — no assumptions
      let status: string;
      if (!hasInvoiceLinks) {
        status = "AWAITING_INVOICE"; // No financial data linked
      } else if (invoicedQty >= requestedQty) {
        status = "COMPLETE";
      } else if (invoicedQty > 0 && invoicedQty < requestedQty) {
        status = "UNDERBILLED";
      } else {
        status = "INVOICE_LINKED";
      }

      // Confidence — based on source quality, NOT assumptions
      let confidence: string;
      if (tl.normalizedProduct !== "UNKNOWN" && requestedQty > 0) {
        confidence = "HIGH"; // Message clearly defines order
      } else if (tl.normalizedProduct !== "UNKNOWN") {
        confidence = "MEDIUM";
      } else {
        confidence = "LOW";
      }

      // Type — based on actual links
      let lineType: string;
      if (!hasInvoiceLinks) {
        lineType = "MESSAGE_LINKED"; // Only linked to WhatsApp, no financial data
      } else {
        const billLinked = tl.invoiceMatches.filter((m) => m.invoiceLine.isBillLinked).length;
        const manual = tl.invoiceMatches.filter((m) => !m.invoiceLine.isBillLinked).length;
        if (billLinked > 0 && manual === 0) lineType = "BILL_LINKED";
        else if (manual > 0 && billLinked === 0) lineType = "MANUAL_INVOICE";
        else lineType = "MIXED";
      }

      return {
        id: tl.id,
        product: tl.normalizedProduct,
        rawText: tl.rawText,
        sender: tl.sender,
        date: tl.date,
        orderThread: tl.orderThread?.label || null,
        requestedQty,
        requestedUnit: tl.requestedUnit,
        invoicedQty,
        difference: hasInvoiceLinks ? invoicedQty - requestedQty : 0,
        invoicedAmount,
        status,
        lineType,
        confidence,
        sourceMessageId: tl.sourceMessageId,
        invoiceMatches: tl.invoiceMatches.map((m) => ({
          invoiceNumber: m.invoiceLine.invoiceNumber,
          qty: Number(m.invoiceLine.qty),
          amount: Number(m.invoiceLine.amount || 0),
          rawSite: m.invoiceLine.site,
          canonicalSite: m.invoiceLine.canonicalSite,
          siteAliasUsed: m.invoiceLine.siteAliasUsed,
          orderRefRaw: m.invoiceLine.orderRefRaw,
          isBillLinked: m.invoiceLine.isBillLinked,
          invoiceLineType: m.invoiceLine.invoiceLineType,
          billingConfidence: m.invoiceLine.billingConfidence,
          matchMethod: m.matchMethod,
          matchUsedSiteAlias: m.matchUsedSiteAlias,
          matchUsedOrderRef: m.matchUsedOrderRef,
        })),
      };
    });

    // Summary — only real values
    const allInvoiceLines = await prisma.backlogInvoiceLine.findMany({ where: { caseId } });
    const totalInvoicedValue = allInvoiceLines.reduce((s, il) => s + Number(il.amount || 0), 0);
    const totalBillLinkedValue = allInvoiceLines.filter((il) => il.isBillLinked).reduce((s, il) => s + Number(il.amount || 0), 0);
    const totalManualValue = allInvoiceLines.filter((il) => !il.isBillLinked).reduce((s, il) => s + Number(il.amount || 0), 0);

    return Response.json({
      caseId,
      reconciliation: rows,
      summary: {
        totalOrderLines: ticketLines.length,
        totalInvoiceLines: allInvoiceLines.length,
        totalInvoicedValue: Math.round(totalInvoicedValue * 100) / 100,
        totalBillLinkedValue: Math.round(totalBillLinkedValue * 100) / 100,
        totalManualValue: Math.round(totalManualValue * 100) / 100,
        awaitingInvoice: rows.filter((r) => r.status === "AWAITING_INVOICE").length,
        statusCounts: {
          MESSAGE_LINKED: rows.filter((r) => r.status === "MESSAGE_LINKED" || r.status === "AWAITING_INVOICE").length,
          COMPLETE: rows.filter((r) => r.status === "COMPLETE").length,
          UNDERBILLED: rows.filter((r) => r.status === "UNDERBILLED").length,
          AWAITING_INVOICE: rows.filter((r) => r.status === "AWAITING_INVOICE").length,
        },
      },
    });
  } catch (error) {
    console.error("Reconciliation summary failed:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

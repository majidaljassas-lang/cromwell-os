/**
 * Bill extractor — DOWNLOADED → PARSED.
 *
 * Takes rawText on an IntakeDocument, runs the existing bill-parser (generic
 * tabular + Kerridge K8 + Zoho-style) or zoho-parser when the doc came from a
 * Zoho pull, and writes a SupplierBill + SupplierBillLine rows.
 *
 * Reuses logic, never duplicates it.
 */

import { prisma } from "@/lib/prisma";
import { parseBillText } from "@/lib/ingestion/bill-parser";
import { extractBillFromText } from "@/lib/bills/ai-extractor";
import { markStatus, bumpRetry } from "../queue";
import { logAudit } from "@/lib/ingestion/audit";
import { enqueueUnresolvedParty } from "@/lib/parties/review-queue";

// Subjects/refs that are decisively NOT bills. If the source matches one of
// these the extractor refuses to mint a SupplierBill, regardless of what the
// tabular parser found. Per outlook_accounts_payable_rule.md, only Invoice /
// Credit / ORD- subjects are bills; this list rejects the most common false
// positives.
const NON_BILL_KEYWORDS = [
  "order confirmation",
  "order acknowledgement",
  "order acknowledgment",
  "po acknowledgement",
  "po acknowledgment",
  "quotation",
  "quote ref",
  "delivery note",
  "delivery confirmation",
  "dispatch note",
  "despatch note",
  "statement of account",
  "remittance advice",
  "purchase order",
];

function looksLikeNonBill(sourceRef: string | null): string | null {
  if (!sourceRef) return null;
  const haystack = sourceRef.toLowerCase();
  for (const kw of NON_BILL_KEYWORDS) {
    if (haystack.includes(kw)) return kw;
  }
  return null;
}

export async function runBillExtractor(docId: string): Promise<"PARSED" | "OCR_REQUIRED" | "ERROR" | "REVIEW_REQUIRED"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc) return "ERROR";

  try {
    const nonBillHit = looksLikeNonBill(doc.sourceRef);
    if (nonBillHit) {
      await markStatus(docId, "DEAD_LETTER", {
        errorMessage: `Source is not a bill: matched "${nonBillHit}" in sourceRef "${doc.sourceRef}"`,
      });
      await logAudit({
        objectType: "IntakeDocument",
        objectId:   doc.id,
        actionType: "BILL_EXTRACTOR_REJECTED",
        actor:      "SYSTEM",
        newValue:   { reason: nonBillHit, sourceRef: doc.sourceRef },
        reason:     "sourceRef matches non-bill keyword; refusing to create SupplierBill",
      });
      return "REVIEW_REQUIRED";
    }

    const text = doc.rawText ?? "";
    if (!text || text.trim().length < 40) {
      await markStatus(docId, "OCR_REQUIRED", { errorMessage: "rawText missing/short — bill extractor needs OCR" });
      return "OCR_REQUIRED";
    }

    // Prefer the AI extractor (it can read vertical-text PDF layouts the regex
    // parser cannot). Fall back to the regex parser only when AI returns zero
    // lines, so cases the regex parser already handles do not regress.
    const ai = await extractBillFromText(text).catch(() => null);
    const regex = parseBillText(text);

    type NormalisedLine = {
      description: string;
      productCode: string | null;
      qty: number;
      unitCost: number;
      lineTotal: number;
      vatAmount: number | null;
    };

    const aiLines: NormalisedLine[] = (ai?.lines ?? []).map((l) => ({
      description: l.description,
      productCode: null,
      qty:         l.qty,
      unitCost:    l.unitCost,
      lineTotal:   l.lineTotal,
      vatAmount:   l.vatRate !== null ? Number((l.lineTotal * (l.vatRate / 100)).toFixed(2)) : null,
    }));

    const useAi = aiLines.length > 0;
    const parsed = {
      lines:        useAi ? aiLines : regex.lines,
      billNo:       (useAi ? ai?.invoiceNo  : null) ?? regex.billNo,
      billDate:     (useAi ? ai?.invoiceDate : null) ?? regex.billDate,
      supplierName: (useAi ? ai?.supplierName : null) ?? regex.supplierName,
      grandTotal:   (useAi ? ai?.totalIncVat ?? ai?.totalExVat : null) ?? regex.grandTotal,
    };

    if (!parsed.lines.length) {
      // Enhanced non-bill detection: check document content for markers of non-invoice documents.
      // This catches: statements, credit notes, downpayment requests, remittance advice, etc.
      // that have no recognisable line items — these should DEAD_LETTER, not retry-loop.
      const detectionHaystack =
        `${(doc.sourceRef ?? "").toLowerCase()} ${text.slice(0, 1500).toLowerCase()}`;

      // Terminal non-bill patterns: documents that are structurally non-invoices
      const nonBillPatterns = [
        { pattern: /\bstatement\b/, label: "statement" },
        { pattern: /\bcredit note\b/, label: "credit_note" },
        { pattern: /\b(downpayment|down.?payment|downpay)\b/, label: "downpayment_request" },
        { pattern: /\b(remittance|remit)\b/, label: "remittance" },
        { pattern: /\b(order confirmation|order ack|po ack)\b/, label: "order_confirmation" },
        { pattern: /\b(quotation|quote)\b/, label: "quotation" },
      ];

      const detectedNonBill = nonBillPatterns.find((p) => p.pattern.test(detectionHaystack));
      if (detectedNonBill && !parsed.billNo) {
        // No billNo + matches a non-bill pattern → this is genuinely not a bill
        await markStatus(docId, "DEAD_LETTER", {
          errorMessage:
            `Routed away from bill pipeline: ${detectedNonBill.label} detected (no billNo found)`,
        });
        await logAudit({
          objectType: "IntakeDocument",
          objectId:   doc.id,
          actionType: "BILL_EXTRACTOR_REJECTED",
          actor:      "SYSTEM",
          newValue:   { reason: detectedNonBill.label, sourceRef: doc.sourceRef, billNo: parsed.billNo },
          reason:     `${detectedNonBill.label} + no billNo; refusing to create SupplierBill`,
        });
        return "REVIEW_REQUIRED";
      }

      // If we have no lines AND no billNo AND high retry count, this is likely OCR corruption
      // or a genuinely unparseable layout. Route to REVIEW_REQUIRED instead of looping forever.
      const retryCount = doc.retryCount ?? 0;
      if (retryCount >= 3) {
        await markStatus(docId, "REVIEW_REQUIRED", {
          errorMessage: `No line items extracted after ${retryCount} retries (no billNo found). Document may have corrupted OCR or unusual layout. Human review needed.`,
        });
        await logAudit({
          objectType: "IntakeDocument",
          objectId:   doc.id,
          actionType: "BILL_EXTRACTOR_ABANDONED",
          actor:      "SYSTEM",
          newValue:   { retryCount, reason: "max_retries_no_lines" },
          reason:     "Exceeded retry limit with zero lines; routing to REVIEW_REQUIRED",
        });
        return "REVIEW_REQUIRED";
      }

      await bumpRetry(docId, "No bill lines extracted — parser produced zero rows");
      return "ERROR";
    }

    // Resolve supplier by name (fuzzy — exact match first, then alias, else TODO create)
    let supplierId: string | null = null;
    if (parsed.supplierName) {
      const byName = await prisma.supplier.findFirst({ where: { name: { equals: parsed.supplierName, mode: "insensitive" } } });
      if (byName) supplierId = byName.id;
      if (!supplierId) {
        const byAlias = await prisma.supplierAlias.findFirst({ where: { alias: { equals: parsed.supplierName, mode: "insensitive" } } });
        if (byAlias) supplierId = byAlias.supplierId;
      }
    }

    if (!supplierId) {
      // No silent stub creation. Park the IntakeDocument and enqueue a review.
      const rawValue = parsed.supplierName || `Unknown (${doc.sourceType})`;
      await enqueueUnresolvedParty({
        party: "SUPPLIER",
        rawValue,
        description: `Bill extractor could not resolve supplier "${rawValue}" (IntakeDocument ${doc.id})`,
        entityType: "IntakeDocument",
        entityId: doc.id,
      });
      await markStatus(docId, "REVIEW_REQUIRED", {
        errorMessage: `Supplier unresolved: "${rawValue}". Match in ReviewQueue (UNRESOLVED_SUPPLIER) to continue.`,
      });
      return "REVIEW_REQUIRED";
    }

    const billNo = parsed.billNo || `DOC-${doc.id.slice(0, 8)}`;
    const billDate = parsed.billDate ? new Date(parsed.billDate) : new Date();
    const rawTotal = parsed.grandTotal ?? parsed.lines.reduce((s, l) => s + l.lineTotal, 0);

    // Sanity gate — never create a SupplierBill with an implausible total.
    // £14.8M Sage SQL-string artefacts and similar parser noise must NOT
    // become bills. Route to REVIEW_REQUIRED instead so a human can inspect.
    const MAX_PLAUSIBLE_TOTAL = 1_000_000;
    if (!Number.isFinite(rawTotal) || rawTotal < 0 || rawTotal > MAX_PLAUSIBLE_TOTAL) {
      await markStatus(docId, "REVIEW_REQUIRED", {
        errorMessage: `Bill total £${Math.round(rawTotal).toLocaleString()} exceeds £${MAX_PLAUSIBLE_TOTAL.toLocaleString()} sanity ceiling — parser likely captured wrong number. Inspect rawText.`,
      });
      return "REVIEW_REQUIRED";
    }
    const cleanLines = parsed.lines.filter(
      (l) => Number.isFinite(l.lineTotal) && l.lineTotal >= 0 && l.lineTotal <= MAX_PLAUSIBLE_TOTAL
    );
    if (cleanLines.length === 0 && parsed.lines.length > 0) {
      await markStatus(docId, "REVIEW_REQUIRED", {
        errorMessage: `All ${parsed.lines.length} extracted lines exceeded £${MAX_PLAUSIBLE_TOTAL.toLocaleString()} ceiling — parser noise.`,
      });
      return "REVIEW_REQUIRED";
    }
    parsed.lines = cleanLines;
    const total = rawTotal;

    // One SupplierBill per IntakeDocument
    const bill = await prisma.$transaction(async (tx) => {
      const sb = await tx.supplierBill.create({
        data: {
          supplierId,
          billNo,
          billDate,
          status:              "PENDING",
          totalCost:           total,
          sourceAttachmentRef: doc.sourceRef ?? doc.fileRef ?? null,
          intakeDocumentId:    doc.id,
        },
      });

      for (const line of parsed.lines) {
        await tx.supplierBillLine.create({
          data: {
            supplierBillId:     sb.id,
            description:        line.description || "Unknown",
            productCode:        line.productCode ?? undefined,
            extractedSku:       line.productCode ?? undefined,
            qty:                line.qty || 1,
            unitCost:           line.unitCost || 0,
            lineTotal:          line.lineTotal || 0,
            costClassification: "BILLABLE",
            allocationStatus:   "UNALLOCATED",
            commercialStatus:   "READY",
            vatAmount:          line.vatAmount ?? undefined,
            parseConfidence:    doc.parseConfidence ? Number(doc.parseConfidence) : undefined,
            intakeDocumentId:   doc.id,
          },
        });
      }

      return sb;
    });

    await markStatus(docId, "PARSED", { supplierBillId: bill.id, errorMessage: null });

    await logAudit({
      objectType: "SupplierBill",
      objectId:   bill.id,
      actionType: "EXTRACTED",
      actor:      "SYSTEM",
      newValue:   { billNo, lineCount: parsed.lines.length, total },
      reason:     `Extracted from IntakeDocument ${doc.id}`,
    });

    return "PARSED";
  } catch (e) {
    await bumpRetry(docId, e instanceof Error ? e.message : "bill-extractor failed");
    return "ERROR";
  }
}

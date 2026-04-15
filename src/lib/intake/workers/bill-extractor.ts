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
import { markStatus, bumpRetry } from "../queue";
import { logAudit } from "@/lib/ingestion/audit";

export async function runBillExtractor(docId: string): Promise<"PARSED" | "OCR_REQUIRED" | "ERROR"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc) return "ERROR";

  try {
    const text = doc.rawText ?? "";
    if (!text || text.trim().length < 40) {
      await markStatus(docId, "OCR_REQUIRED", { errorMessage: "rawText missing/short — bill extractor needs OCR" });
      return "OCR_REQUIRED";
    }

    const parsed = parseBillText(text);

    if (!parsed.lines.length) {
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
      // Create a placeholder supplier stub so the bill can still enter the pipeline.
      const stub = await prisma.supplier.create({
        data: { name: parsed.supplierName || `Unknown (${doc.sourceType})` },
      });
      supplierId = stub.id;
      await logAudit({
        objectType: "Supplier",
        objectId:   stub.id,
        actionType: "STUB_CREATED",
        actor:      "SYSTEM",
        newValue:   { source: "bill-extractor", sourceRef: doc.sourceRef ?? null },
      });
    }

    const billNo = parsed.billNo || `DOC-${doc.id.slice(0, 8)}`;
    const billDate = parsed.billDate ? new Date(parsed.billDate) : new Date();
    const total = parsed.grandTotal ?? parsed.lines.reduce((s, l) => s + l.lineTotal, 0);

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

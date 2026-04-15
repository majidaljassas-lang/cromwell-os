/**
 * Bill processing pipeline — the orchestrator that carries a classified
 * InboxThread through ingestion → matching → unmatched routing → AP ledger.
 *
 * Entrypoint: processBillThread(threadId). Idempotent — if a SupplierBill
 * already exists for the thread (sourceThreadId), the pipeline short-circuits
 * to matching so re-runs converge instead of creating duplicates.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { extractBillFromText } from "./ai-extractor";
import { matchBillLine } from "@/lib/intake/match-engine";
import { allocateBillLine } from "@/lib/intake/allocation-engine";
import { resolveSupplier } from "./supplier-resolver";
import { inferDueDate } from "./due-date";

export interface PipelineResult {
  threadId: string;
  supplierBillId: string | null;
  created: boolean;
  extractedLines: number;
  matched: number;
  exceptions: number;
  allUnmatchedRouted: boolean;
  errors: string[];
}

export async function processBillThread(threadId: string): Promise<PipelineResult> {
  const result: PipelineResult = {
    threadId,
    supplierBillId: null,
    created: false,
    extractedLines: 0,
    matched: 0,
    exceptions: 0,
    allUnmatchedRouted: true,
    errors: [],
  };

  const thread = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!thread) {
    result.errors.push(`InboxThread ${threadId} not found`);
    return result;
  }
  if (thread.classification && thread.classification !== "BILL") {
    result.errors.push(`Thread classification is ${thread.classification}, not BILL`);
    return result;
  }

  const existing = await prisma.supplierBill.findFirst({ where: { sourceThreadId: threadId } });
  let bill = existing;

  if (!bill) {
    const rawText = buildThreadText(thread);
    const extracted = await extractBillFromText(rawText);
    result.extractedLines = extracted.lines.length;

    if (extracted.lines.length === 0) {
      result.errors.push("AI extractor returned zero line items — thread may not be a parseable bill");
      return result;
    }

    const supplierId = await resolveSupplier({
      name: extracted.supplierName,
      participants: thread.participants,
    });

    const invoiceDate = extracted.invoiceDate ? new Date(extracted.invoiceDate) : new Date();
    const dueDate = extracted.dueDate
      ? new Date(extracted.dueDate)
      : inferDueDate(invoiceDate, rawText, supplierId ? undefined : null);

    const billNo = extracted.invoiceNo || `THREAD-${threadId.slice(0, 8)}`;

    const totalExVat  = extracted.totalExVat  ?? extracted.lines.reduce((s, l) => s + l.lineTotal, 0);
    const vatAmount   = extracted.vatAmount   ?? round2(totalExVat * 0.20);
    const totalIncVat = extracted.totalIncVat ?? round2(totalExVat + vatAmount);

    bill = await prisma.$transaction(async (tx) => {
      const sb = await tx.supplierBill.create({
        data: {
          supplierId,
          billNo,
          billDate:      invoiceDate,
          dueDate,
          status:        "OPEN",
          paymentStatus: "UNPAID",
          amountExVat:   totalExVat,
          vatAmount,
          amountIncVat:  totalIncVat,
          totalCost:     totalExVat,
          sourceThreadId: threadId,
        },
      });

      for (const line of extracted.lines) {
        const lineVat = line.vatRate !== null
          ? round2(line.lineTotal * (line.vatRate / 100))
          : null;
        await tx.supplierBillLine.create({
          data: {
            supplierBillId:     sb.id,
            description:        line.description,
            qty:                line.qty,
            unitCost:           line.unitCost,
            lineTotal:          line.lineTotal,
            amountExVat:        line.lineTotal,
            vatAmount:          lineVat ?? undefined,
            vatRate:            line.vatRate ?? undefined,
            amountIncVat:       lineVat !== null ? round2(line.lineTotal + lineVat) : undefined,
            originalUom:        line.unit ?? undefined,
            costClassification: "BILLABLE",
            allocationStatus:   "UNALLOCATED",
            commercialStatus:   "READY",
            parseConfidence:    extracted.confidence,
          },
        });
      }

      return sb;
    });

    result.created = true;

    await logAudit({
      objectType: "SupplierBill",
      objectId:   bill.id,
      actionType: "INGESTED_FROM_THREAD",
      actor:      "SYSTEM",
      newValue: {
        threadId,
        extractorSource: extracted.source,
        confidence: extracted.confidence,
        lineCount: extracted.lines.length,
        totalIncVat,
      },
    });
  }

  result.supplierBillId = bill.id;

  // ── Match + route every line
  const lines = await prisma.supplierBillLine.findMany({
    where: { supplierBillId: bill.id },
    select: { id: true, allocationStatus: true },
  });

  for (const line of lines) {
    try {
      const match = await matchBillLine(line.id);
      if (match.best?.action === "AUTO_LINKED") {
        result.matched += 1;
      }

      const alloc = await allocateBillLine(line.id);
      if (alloc.hasUnresolved) {
        result.allUnmatchedRouted = false;
        result.exceptions += 1;
      }
    } catch (e) {
      result.errors.push(`line ${line.id}: ${e instanceof Error ? e.message : "unknown"}`);
      result.exceptions += 1;
    }
  }

  await logAudit({
    objectType: "SupplierBill",
    objectId:   bill.id,
    actionType: "PIPELINE_COMPLETE",
    actor:      "SYSTEM",
    newValue: {
      threadId,
      matched: result.matched,
      exceptions: result.exceptions,
      allUnmatchedRouted: result.allUnmatchedRouted,
    },
  });

  return result;
}

function buildThreadText(thread: {
  subject: string | null;
  participants: string[];
  messages: Array<{ sender: string | null; snippet: string | null; occurredAt: Date }>;
}): string {
  const header = [
    thread.subject ? `Subject: ${thread.subject}` : "",
    thread.participants.length ? `Participants: ${thread.participants.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const body = thread.messages.map((m) => {
    const when = m.occurredAt.toISOString();
    const who  = m.sender ?? "unknown";
    return `[${when}] ${who}\n${m.snippet ?? ""}`;
  }).join("\n\n---\n\n");

  return `${header}\n\n${body}`.trim();
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

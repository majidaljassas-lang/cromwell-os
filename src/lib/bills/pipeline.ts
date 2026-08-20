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
import { allocateBillLines } from "./ai-allocator";
import { resolveTasksForSignal } from "@/lib/ingestion/signal-resolver";
import { ensureAttachmentsExtracted } from "@/lib/ingestion/ensure-attachments";

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
    const rawText = await buildBillSourceText(thread);
    const extracted = await extractBillFromText(rawText);
    result.extractedLines = extracted.lines.length;

    if (extracted.lines.length === 0) {
      result.errors.push("AI extractor returned zero line items — thread may not be a parseable bill");
      const snippet = rawText.slice(0, 200).replace(/\s+/g, " ").trim();
      await prisma.reviewQueueItem.create({
        data: {
          // UNRESOLVED_PARSE not in ReviewQueueType enum; using closest match.
          queueType: "MISSING_ORDER_EVIDENCE",
          status: "OPEN_REVIEW",
          entityType: "InboxThread",
          entityId: threadId,
          rawValue: extracted.supplierName ?? null,
          description:
            `Bill parser returned no lines for thread "${thread.subject ?? "(no subject)"}" ` +
            `(supplier: ${extracted.supplierName ?? "unknown"}). Snippet: ${snippet}`,
        },
      });
      return result;
    }

    const supplierId = await resolveSupplier({
      name: extracted.supplierName,
      participants: thread.participants,
    });

    if (!supplierId) {
      result.errors.push(
        `Supplier could not be resolved (extracted name: "${extracted.supplierName ?? "—"}"). ` +
          `Parked in ReviewQueue (UNRESOLVED_SUPPLIER). Bill not created until matched.`,
      );
      return result;
    }

    const invoiceDate = extracted.invoiceDate ? new Date(extracted.invoiceDate) : new Date();
    const dueDate = extracted.dueDate
      ? new Date(extracted.dueDate)
      : inferDueDate(invoiceDate, rawText);

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

  try {
    await allocateBillLines(bill.id);
  } catch (e) {
    result.errors.push(`ai-allocator: ${e instanceof Error ? e.message : "unknown"}`);
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

  // Fire the BILL_DOCUMENT signal so any open watchlist tasks (e.g. statement
  // chases of this billNo) can auto-close. Scoped by supplierId so a bill from
  // supplier A can't accidentally close supplier B's chase task with the same
  // raw number.
  try {
    const closed = await resolveTasksForSignal({
      docType: "BILL_DOCUMENT",
      matcher: { billNo: bill.billNo, supplierId: bill.supplierId },
      source: bill.id,
    });
    if (closed.closedTaskIds.length > 0) {
      await logAudit({
        objectType: "SupplierBill",
        objectId: bill.id,
        actionType: "AUTO_CLOSED_WATCHLIST_TASKS",
        actor: "SYSTEM",
        newValue: { closedTaskIds: closed.closedTaskIds, count: closed.closedTaskIds.length },
      });
    }
  } catch (e) {
    result.errors.push(`signal-resolver: ${e instanceof Error ? e.message : "unknown"}`);
  }

  return result;
}

/**
 * Build the text the AI extractor sees for this bill thread.
 *
 * Snippets alone are useless for parseable bills — the line items live in the
 * PDF attachment. We invoke ensureAttachmentsExtracted for each message so
 * the attachment text is merged onto the message's ParsedMessage.extractedText
 * (idempotent — skipped if already merged), then concatenate full extracted
 * text per message instead of the snippet preview.
 */
async function buildBillSourceText(thread: {
  subject: string | null;
  participants: string[];
  messages: Array<{ ingestionEventId: string; sender: string | null; snippet: string | null; occurredAt: Date }>;
}): Promise<string> {
  for (const msg of thread.messages) {
    try {
      await ensureAttachmentsExtracted(msg.ingestionEventId);
    } catch {
      // Best-effort: a single message's attachment failure shouldn't kill
      // the whole pipeline. Other messages may still carry the bill text.
    }
  }

  const eventIds = thread.messages.map((m) => m.ingestionEventId).filter(Boolean);
  const parsed = eventIds.length
    ? await prisma.parsedMessage.findMany({
        where: { ingestionEventId: { in: eventIds } },
        select: { ingestionEventId: true, extractedText: true },
      })
    : [];
  const textByEventId = new Map(parsed.map((p) => [p.ingestionEventId, p.extractedText]));

  const header = [
    thread.subject ? `Subject: ${thread.subject}` : "",
    thread.participants.length ? `Participants: ${thread.participants.join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const body = thread.messages.map((m) => {
    const when = m.occurredAt.toISOString();
    const who  = m.sender ?? "unknown";
    const text = textByEventId.get(m.ingestionEventId) ?? m.snippet ?? "";
    return `[${when}] ${who}\n${text}`;
  }).join("\n\n---\n\n");

  return `${header}\n\n${body}`.trim();
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

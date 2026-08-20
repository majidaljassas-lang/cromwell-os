/**
 * Reaction runner — invoked when the user clicks a reaction button in /inbox.
 *
 * Algorithm per (threadId, reactionId):
 *   1. Resolve the ReactionSpec.
 *   2. Build a context (linkedTicket, linkedBill, linkedInvoice, customer,
 *      supplier, site) from the thread + its existing AI entities.
 *   3. If spec.swallowsTask (ARCHIVE_NOISE only): no Task; just advance the
 *      thread to ARCHIVED.
 *   4. Otherwise create a Task atomically with the thread update:
 *        - Task.taskType    = spec.taskType
 *        - Task.priority    = spec.priority
 *        - Task.closesOnSignal populated when applicable
 *        - InboxThread.reactionTaskId = task.id
 *        - InboxThread.status = spec.terminalThreadStatus
 *        - InboxThread.triagedAt = now
 *        - InboxThread.triageAction mirrored for legacy UI
 *   5. Audit-log + return the destination URL the UI should navigate to.
 *
 * Never invoked autonomously by the run-all pipeline. The user always picks
 * the reaction (suggested or alternative) — this function executes their
 * choice.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { processBillThread } from "@/lib/bills/pipeline";
import { processBill } from "@/lib/finance/bill-processor";
import {
  REACTIONS,
  type ReactionContext,
  type ReactionId,
  type TerminalThreadStatus,
} from "./reactions";
import type { InboxThreadStatus } from "@/generated/prisma";

export interface ExecuteReactionResult {
  ok: boolean;
  taskId: string | null;
  threadStatus: InboxThreadStatus;
  destinationRoute: string | null;
  error?: "NOT_FOUND" | "UNKNOWN_REACTION" | "DB_ERROR" | "BILL_EXTRACT_FAILED";
  message?: string;
}

interface AiEntities {
  siteName?: string | null;
  customerName?: string | null;
  poRef?: string | null;
}

export async function executeReaction(
  threadId: string,
  reactionId: ReactionId,
  actor: string,
): Promise<ExecuteReactionResult> {
  const spec = REACTIONS[reactionId];
  if (!spec) {
    return { ok: false, taskId: null, threadStatus: "NEW", destinationRoute: null, error: "UNKNOWN_REACTION" };
  }

  const thread = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    select: {
      id: true,
      status: true,
      linkedTicketId: true,
      aiSummary: true,
      aiEntities: true,
      reactionTaskId: true,
      participants: true,
      linkedTicket: {
        select: {
          payingCustomerId: true,
          siteId: true,
        },
      },
    },
  });
  if (!thread) {
    return { ok: false, taskId: null, threadStatus: "NEW", destinationRoute: null, error: "NOT_FOUND" };
  }

  const entities = (thread.aiEntities ?? null) as AiEntities | null;

  // Resolve linked supplier bill / sales invoice / supplier where possible.
  // Best-effort — runner doesn't fail if we can't resolve them.
  let [linkedBill, linkedInvoice, linkedSupplier] = await Promise.all([
    resolveLinkedSupplierBill(thread.linkedTicketId, thread.id),
    resolveLinkedSalesInvoice(thread.linkedTicketId),
    resolveLinkedSupplier(thread.participants),
  ]);

  // PROCESS_BILL: kick the parser + AP poster before we record the reaction.
  // The user's "Process bill" click is the human ack — after that, parse +
  // post is fully automatic (per feedback_system_autonomy.md). If the bill
  // is already POSTED, this is a no-op.
  if (reactionId === "PROCESS_BILL") {
    const billId = await kickBillPipeline(thread.id, linkedBill);
    if (billId) {
      linkedBill = billId;
    } else {
      // Bill extraction failed — usually means the thread isn't actually a
      // bill (e.g. customer PO mis-tagged as BILL by the keyword classifier),
      // or the AI extractor found no parseable lines. Don't silently archive —
      // bail out so the user can re-classify.
      return {
        ok: false,
        taskId: null,
        threadStatus: thread.status,
        destinationRoute: null,
        error: "BILL_EXTRACT_FAILED",
        message:
          "Couldn't extract a bill from this thread. It may be a customer PO mis-tagged " +
          "as a bill, or the PDF wasn't readable. Pick a different reaction (e.g. → Create ticket) " +
          "or check the thread.",
      };
    }
  }

  const ctx: ReactionContext = {
    threadId: thread.id,
    linkedTicketId: thread.linkedTicketId,
    linkedSupplierBillId: linkedBill,
    linkedSalesInvoiceId: linkedInvoice,
    customerId: thread.linkedTicket?.payingCustomerId ?? null,
    supplierId: linkedSupplier,
    siteId: thread.linkedTicket?.siteId ?? null,
    poRef: entities?.poRef ?? null,
  };

  const destinationRoute = spec.destinationRoute(ctx);

  // Special case: ARCHIVE_NOISE creates no Task.
  if (spec.swallowsTask) {
    await prisma.$transaction(async (tx) => {
      await tx.inboxThread.update({
        where: { id: thread.id },
        data: {
          status: spec.terminalThreadStatus,
          triagedAt: new Date(),
          triagedBy: actor,
          noisedAt: new Date(),
          triageAction: spec.taskType,
          reactionTaskId: null,
        },
      });
    });

    await logAudit({
      objectType: "InboxThread",
      objectId: thread.id,
      actionType: "INBOX_REACTION",
      actor,
      newValue: { reactionId, taskId: null, terminalStatus: spec.terminalThreadStatus },
    });

    return {
      ok: true,
      taskId: null,
      threadStatus: spec.terminalThreadStatus as InboxThreadStatus,
      destinationRoute,
    };
  }

  // Standard path: create the Task and pivot the thread.
  const result = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        ticketId: thread.linkedTicketId,
        // Link the Task to the bill so post-allocate hooks (and the bill
        // processor's auto-link-to-ticket pass) can find it.
        supplierBillId: linkedBill ?? undefined,
        taskType: spec.taskType,
        priority: spec.priority,
        status: "OPEN",
        generatedReason: thread.aiSummary ?? `Reaction: ${spec.label}`,
        closesOnSignal: spec.closesOnSignal
          ? buildSignalMatcher(spec.closesOnSignal, ctx)
          : undefined,
      },
    });

    await tx.inboxThread.update({
      where: { id: thread.id },
      data: {
        status: spec.terminalThreadStatus,
        triagedAt: new Date(),
        triagedBy: actor,
        triageAction: spec.taskType,
        reactionTaskId: task.id,
      },
    });

    return task;
  });

  await logAudit({
    objectType: "InboxThread",
    objectId: thread.id,
    actionType: "INBOX_REACTION",
    actor,
    newValue: {
      reactionId,
      taskId: result.id,
      terminalStatus: spec.terminalThreadStatus,
      destinationRoute,
    },
  });

  return {
    ok: true,
    taskId: result.id,
    threadStatus: spec.terminalThreadStatus as InboxThreadStatus,
    destinationRoute,
  };
}

/**
 * Undo a reaction: cancels the Task (status=CANCELLED) and resets the thread
 * to NEW. Used by the inbox row's undo button.
 */
export async function undoReaction(threadId: string, actor: string): Promise<{ ok: boolean }> {
  const thread = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    select: { reactionTaskId: true, status: true },
  });
  if (!thread) return { ok: false };

  await prisma.$transaction(async (tx) => {
    if (thread.reactionTaskId) {
      await tx.task.update({
        where: { id: thread.reactionTaskId },
        data: { status: "CANCELLED" },
      });
    }
    await tx.inboxThread.update({
      where: { id: threadId },
      data: {
        status: "NEW",
        reactionTaskId: null,
        triagedAt: null,
        triagedBy: null,
        triageAction: null,
        noisedAt: null,
      },
    });
  });

  await logAudit({
    objectType: "InboxThread",
    objectId: threadId,
    actionType: "INBOX_REACTION_UNDO",
    actor,
    previousValue: { taskId: thread.reactionTaskId, status: thread.status },
  });

  return { ok: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildSignalMatcher(
  signal: { docType: string; matcherKeys: string[] },
  ctx: ReactionContext,
): { docType: string; matcher: Record<string, string> } {
  const matcher: Record<string, string> = {};
  for (const key of signal.matcherKeys) {
    const v = (ctx as unknown as Record<string, string | null>)[key];
    if (v) matcher[key] = v;
  }
  return { docType: signal.docType, matcher };
}

async function resolveLinkedSupplierBill(
  ticketId: string | null,
  threadId: string,
): Promise<string | null> {
  // 1. The thread itself usually has the bill attached as an IntakeDocument
  //    (via IngestionEvent → ParsedMessage → IntakeDocument → SupplierBill).
  //    This is the strongest signal — the bill the thread is ABOUT.
  const messages = await prisma.inboxThreadMessage.findMany({
    where: { threadId },
    select: { ingestionEventId: true },
    take: 10,
  });
  const eventIds = messages.map((m) => m.ingestionEventId).filter(Boolean) as string[];
  if (eventIds.length > 0) {
    const docFromEvent = await prisma.intakeDocument.findFirst({
      where: { ingestionEventId: { in: eventIds }, supplierBillId: { not: null } },
      select: { supplierBillId: true },
      orderBy: { createdAt: "desc" },
    });
    if (docFromEvent?.supplierBillId) return docFromEvent.supplierBillId;
  }

  // 2. Fall back to bills allocated to the thread's linked ticket.
  if (!ticketId) return null;
  const bill = await prisma.supplierBill.findFirst({
    where: { lines: { some: { ticketId } } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return bill?.id ?? null;
}

async function resolveLinkedSalesInvoice(ticketId: string | null): Promise<string | null> {
  if (!ticketId) return null;
  const inv = await prisma.salesInvoice.findFirst({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return inv?.id ?? null;
}

async function resolveLinkedSupplier(participants: string[]): Promise<string | null> {
  if (!participants || participants.length === 0) return null;
  // The first participant tends to be the sender for inbound emails.
  const sender = participants[0];
  if (!sender || !sender.includes("@")) return null;
  const domain = sender.split("@")[1]?.toLowerCase();
  if (!domain) return null;
  // Exact email match first
  const byEmail = await prisma.supplier.findFirst({
    where: { email: { equals: sender, mode: "insensitive" } },
    select: { id: true },
  });
  if (byEmail) return byEmail.id;
  // Then alias
  const byAlias = await prisma.supplierAlias.findFirst({
    where: { alias: { equals: sender, mode: "insensitive" } },
    select: { supplierId: true },
  });
  if (byAlias) return byAlias.supplierId;
  return null;
}

/**
 * PROCESS_BILL pipeline:
 *   1. Run processBillThread(threadId) — AI extracts the bill from thread
 *      text, resolves the supplier, creates a SupplierBill + lines, runs
 *      line matching against open POs/tickets. Idempotent: returns the
 *      existing bill if one already lives at thread.sourceThreadId.
 *   2. Run processBill(billId) — posts the AP journal entry (Materials Dr,
 *      VAT Dr, Trade Creditors Cr) and re-runs line matching.
 *
 * Returns the SupplierBill id, or null if extraction failed (no parseable
 * lines, supplier unresolved, etc). Errors are audit-logged but never throw —
 * the reaction-runner still proceeds to record the user's intent.
 */
async function kickBillPipeline(
  threadId: string,
  alreadyResolvedBillId: string | null,
): Promise<string | null> {
  try {
    // Step 1: AI extract + create SupplierBill from thread.
    let billId = alreadyResolvedBillId;
    if (!billId) {
      const result = await processBillThread(threadId);
      if (result.supplierBillId) {
        billId = result.supplierBillId;
        await logAudit({
          objectType: "InboxThread",
          objectId: threadId,
          actionType: "BILL_PIPELINE_RAN",
          newValue: {
            supplierBillId: billId,
            extractedLines: result.extractedLines,
            matched: result.matched,
            errors: result.errors,
          },
        });
      } else {
        await logAudit({
          objectType: "InboxThread",
          objectId: threadId,
          actionType: "BILL_PIPELINE_FAILED",
          newValue: {
            extractedLines: result.extractedLines,
            errors: result.errors,
          },
          reason: result.errors.join("; ") || "processBillThread returned no SupplierBill",
        });
        return null;
      }
    }

    // Step 2: post to AP if not already POSTED.
    const bill = await prisma.supplierBill.findUnique({
      where: { id: billId },
      select: { id: true, status: true },
    });
    if (bill && bill.status !== "POSTED") {
      const postResult = await processBill(billId);
      if (postResult.errors.length > 0) {
        await logAudit({
          objectType: "SupplierBill",
          objectId: billId,
          actionType: "BILL_PROCESS_PARTIAL",
          newValue: { errors: postResult.errors, matchSummary: postResult.matchSummary },
          reason: "processBill returned errors",
        });
      }
    }

    return billId;
  } catch (err) {
    console.error("[reaction-runner] kickBillPipeline failed:", err);
    await logAudit({
      objectType: "InboxThread",
      objectId: threadId,
      actionType: "BILL_PIPELINE_THREW",
      reason: err instanceof Error ? err.message : "unknown error",
    });
    return null;
  }
}

// Re-export TerminalThreadStatus for callers
export type { ReactionId, TerminalThreadStatus };

/**
 * Intake Queue — tiny in-process state machine for IntakeDocument rows.
 *
 * Source-agnostic. Every document (Zoho pull, email PDF, manual upload, OCR scan)
 * moves through the same pipeline:
 *
 *   NEW
 *    └► DOWNLOADED          (fileRef + rawText populated if the source already has text)
 *        └► OCR_REQUIRED    (text missing / too short → run tesseract or mark for manual)
 *        └► PARSED          (bill header + lines extracted; SupplierBill + lines created)
 *            └► MATCH_PENDING
 *                └► AUTO_MATCHED / REVIEW_REQUIRED
 *                    └► APPROVED
 *                        └► POSTED (downstream records written)
 *
 * Errors with retryCount < 5 → back to previous status with nextAttemptAt bumped.
 * retryCount >= 5 → DEAD_LETTER.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export type DocumentQueueStatus =
  | "NEW" | "DOWNLOADED" | "OCR_REQUIRED" | "PARSED"
  | "MATCH_PENDING" | "AUTO_MATCHED" | "REVIEW_REQUIRED"
  | "APPROVED" | "POSTED" | "ERROR" | "DEAD_LETTER";

export const MAX_RETRIES = 5;

const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600] as const;

export async function enqueueDocument(input: {
  sourceType: string;
  sourceRef?: string | null;
  fileRef?: string | null;
  rawText?: string | null;
  ingestionEventId?: string | null;
  supplierBillId?: string | null;
  checksum?: string | null;
}): Promise<{ doc: Awaited<ReturnType<typeof prisma.intakeDocument.create>>; created: boolean }> {
  // Idempotency guard — skip if a document with the same ingestionEventId + fileRef already exists.
  // This prevents duplicate queue entries when the Outlook sync is re-run on an already-processed email.
  if (input.ingestionEventId && input.fileRef) {
    const existing = await prisma.intakeDocument.findFirst({
      where: {
        ingestionEventId: input.ingestionEventId,
        fileRef: input.fileRef,
      },
    });
    if (existing) {
      return { doc: existing as Awaited<ReturnType<typeof prisma.intakeDocument.create>>, created: false };
    }
  }

  const doc = await prisma.intakeDocument.create({
    data: {
      sourceType: input.sourceType,
      sourceRef:  input.sourceRef ?? undefined,
      fileRef:    input.fileRef   ?? undefined,
      rawText:    input.rawText   ?? undefined,
      status:     "NEW",
      ingestionEventId: input.ingestionEventId ?? undefined,
      supplierBillId:   input.supplierBillId ?? undefined,
      checksum:   input.checksum ?? undefined,
    },
  });
  await logAudit({
    objectType: "IntakeDocument",
    objectId:   doc.id,
    actionType: "QUEUED",
    actor:      "SYSTEM",
    newValue:   { sourceType: input.sourceType, sourceRef: input.sourceRef ?? null },
  });
  return { doc, created: true };
}

export async function markStatus(
  id: string,
  status: DocumentQueueStatus,
  opts: { errorMessage?: string | null; parseConfidence?: number | null; supplierBillId?: string | null; nextAttemptAt?: Date | null } = {}
) {
  const data: Record<string, unknown> = {
    status,
    lastAttemptAt: new Date(),
  };
  if (opts.errorMessage !== undefined)   data.errorMessage   = opts.errorMessage ?? null;
  if (opts.parseConfidence !== undefined) data.parseConfidence = opts.parseConfidence;
  if (opts.supplierBillId !== undefined) data.supplierBillId = opts.supplierBillId;
  if (opts.nextAttemptAt  !== undefined) data.nextAttemptAt  = opts.nextAttemptAt;

  return prisma.intakeDocument.update({ where: { id }, data });
}

export async function bumpRetry(id: string, errorMessage: string) {
  const doc = await prisma.intakeDocument.findUnique({ where: { id } });
  if (!doc) return null;
  const next = doc.retryCount + 1;
  const dead = next >= MAX_RETRIES;
  const backoff = BACKOFF_SECONDS[Math.min(next, BACKOFF_SECONDS.length - 1)];
  const updated = await prisma.intakeDocument.update({
    where: { id },
    data: {
      retryCount:    next,
      status:        dead ? "DEAD_LETTER" : "ERROR",
      errorMessage:  errorMessage.slice(0, 2000),
      nextAttemptAt: dead ? null : new Date(Date.now() + backoff * 1000),
      lastAttemptAt: new Date(),
    },
  });
  await logAudit({
    objectType: "IntakeDocument",
    objectId:   id,
    actionType: dead ? "DEAD_LETTERED" : "RETRY_SCHEDULED",
    actor:      "SYSTEM",
    reason:     errorMessage.slice(0, 500),
    newValue:   { retryCount: next, backoffSec: dead ? 0 : backoff },
  });
  return updated;
}

export async function pickNext(status: DocumentQueueStatus, limit = 10) {
  return prisma.intakeDocument.findMany({
    where: {
      status,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export async function queueCounts() {
  const rows = await prisma.intakeDocument.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

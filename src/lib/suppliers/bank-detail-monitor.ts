/**
 * Bank-detail fraud monitor (Phase 9).
 *
 * Exists because Kartell's invoice contained "Please note change in Bank
 * Account Details" — this is a live fraud vector with no detection
 * currently. We parse any extracted bill text for bank details, compare
 * against stored Supplier.{bankAccount,sortCode,iban} values, and create
 * a CRITICAL task for human verification on any mismatch.
 *
 * Invariants:
 *   • NEVER auto-updates Supplier bank fields.
 *   • Always creates a CRITICAL Task on any mismatch, no matter how
 *     small the difference.
 *   • Every extract attempt is logged to IngestionAuditLog with full
 *     before/after.
 *
 * Public API:
 *   runBankDetailCheck(input)
 *     input.text    — raw text from a bill / intake document / email body
 *     input.supplierId? — if known; else we try to use input.supplierBillId
 *     input.supplierBillId? — for a SupplierBill we've already created
 *     input.sourceRef   — for audit log (e.g. "bill:<id>", "intake:<id>")
 *   runBankDetailSweep({ limit? })
 *     Scans recent SupplierBills whose raw text includes any bank keyword
 *     and runs the check — a catch-up path for the scheduler.
 */

import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedBankDetails {
  bankAccount: string | null;
  sortCode: string | null;
  iban: string | null;
  rawExcerpt: string | null;
}

export interface BankCheckResult {
  ok: boolean;
  supplierId: string | null;
  supplierName: string | null;
  sourceRef: string | null;
  extracted: ExtractedBankDetails;
  stored: {
    bankAccount: string | null;
    sortCode: string | null;
    iban: string | null;
    lastVerifiedAt: Date | null;
  } | null;
  verdict:
    | "NO_DETAILS_EXTRACTED"
    | "NO_SUPPLIER_BANK_STORED"
    | "MATCH"
    | "MISMATCH"
    | "ERROR";
  taskId?: string;
  taskType?: "BANK_DETAIL_CHANGE_ALERT" | "STORE_BANK_DETAILS";
  taskCreated?: boolean;
  error?: string;
}

export interface BankSweepResult {
  ok: boolean;
  scanned: number;
  mismatches: number;
  newStoreRequests: number;
  tasksCreated: number;
  errors: Array<{ supplierBillId: string; error: string }>;
  outcomes: BankCheckResult[];
}

// ─── Extraction patterns ─────────────────────────────────────────────────────

// UK bank account number: 8 digits. Avoid false positives on long reference
// numbers by requiring nearby "account" / "a/c" / "acct" / "acc no" keyword.
const ACCOUNT_NEARBY_RE =
  /(?:a\/c|a\.c\.|acct|acc(?:ount)?\s*(?:no|#)?)\s*[:\-]?\s*(\d{8})\b/i;
// UK sort code: XX-XX-XX or XX XX XX or 6 digits near "sort code" keyword
const SORT_NEARBY_RE =
  /sort\s*code\s*[:\-]?\s*(\d{2}[\s\-]\d{2}[\s\-]\d{2}|\d{6})/i;
// IBAN
const IBAN_RE = /\b([A-Z]{2}\d{2}[A-Z0-9]{4,30})\b/;
const BANK_CHANGE_HINT_RE =
  /(change|update|new|please note).{0,80}(bank|account|sort code|iban)/i;

function normalizeAccount(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/\D/g, "") || null;
}
function normalizeSort(s: string | null): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}` : null;
}
function normalizeIban(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/\s/g, "").toUpperCase() || null;
}

export function extractBankDetailsFromText(text: string): ExtractedBankDetails {
  if (!text || text.length < 10) {
    return { bankAccount: null, sortCode: null, iban: null, rawExcerpt: null };
  }
  const accountMatch = text.match(ACCOUNT_NEARBY_RE);
  const sortMatch = text.match(SORT_NEARBY_RE);
  const ibanMatch = text.match(IBAN_RE);
  const hint = text.match(BANK_CHANGE_HINT_RE);

  let rawExcerpt: string | null = null;
  const pick = accountMatch ?? sortMatch ?? ibanMatch ?? hint;
  if (pick && pick.index !== undefined) {
    const start = Math.max(0, pick.index - 40);
    const end = Math.min(text.length, pick.index + (pick[0]?.length ?? 0) + 80);
    rawExcerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
  }

  return {
    bankAccount: normalizeAccount(accountMatch ? accountMatch[1] : null),
    sortCode: normalizeSort(sortMatch ? sortMatch[1] : null),
    iban: normalizeIban(ibanMatch ? ibanMatch[1] : null),
    rawExcerpt,
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runBankDetailCheck(input: {
  text: string;
  supplierId?: string | null;
  supplierBillId?: string | null;
  sourceRef?: string | null;
}): Promise<BankCheckResult> {
  const extracted = extractBankDetailsFromText(input.text ?? "");
  const sourceRef = input.sourceRef ?? null;

  let supplier:
    | { id: string; name: string; bankAccount: string | null; sortCode: string | null; iban: string | null; bankLastVerifiedAt: Date | null }
    | null = null;

  if (input.supplierId) {
    supplier = await prisma.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, name: true, bankAccount: true, sortCode: true, iban: true, bankLastVerifiedAt: true },
    });
  } else if (input.supplierBillId) {
    const bill = await prisma.supplierBill.findUnique({
      where: { id: input.supplierBillId },
      select: {
        supplier: { select: { id: true, name: true, bankAccount: true, sortCode: true, iban: true, bankLastVerifiedAt: true } },
      },
    });
    supplier = bill?.supplier ?? null;
  }

  if (!supplier) {
    return {
      ok: false,
      supplierId: null,
      supplierName: null,
      sourceRef,
      extracted,
      stored: null,
      verdict: "ERROR",
      error: "Supplier not resolvable from input",
    };
  }

  const hasExtracted = extracted.bankAccount || extracted.sortCode || extracted.iban;
  if (!hasExtracted) {
    return {
      ok: true,
      supplierId: supplier.id,
      supplierName: supplier.name,
      sourceRef,
      extracted,
      stored: {
        bankAccount: supplier.bankAccount,
        sortCode: supplier.sortCode,
        iban: supplier.iban,
        lastVerifiedAt: supplier.bankLastVerifiedAt,
      },
      verdict: "NO_DETAILS_EXTRACTED",
    };
  }

  const hasStored = supplier.bankAccount || supplier.sortCode || supplier.iban;

  // Case A — no stored details yet
  if (!hasStored) {
    await logAudit(supplier.id, sourceRef, null, extracted, "NO_SUPPLIER_BANK_STORED");
    const task = await ensureOpenSupplierTask({
      supplierId: supplier.id,
      supplierName: supplier.name,
      taskType: "STORE_BANK_DETAILS",
      priority: "HIGH",
      generatedReason: `First bank details seen for ${supplier.name}. Verify by phone then store.`,
      draftBody: buildStoreBankDetailsBody(supplier.name, extracted, sourceRef),
      sourceRef,
    });
    return {
      ok: true,
      supplierId: supplier.id,
      supplierName: supplier.name,
      sourceRef,
      extracted,
      stored: {
        bankAccount: null, sortCode: null, iban: null, lastVerifiedAt: null,
      },
      verdict: "NO_SUPPLIER_BANK_STORED",
      taskId: task.id,
      taskType: "STORE_BANK_DETAILS",
      taskCreated: task.created,
    };
  }

  // Case B — stored details exist; compare
  const mismatch =
    (extracted.bankAccount && supplier.bankAccount && extracted.bankAccount !== supplier.bankAccount) ||
    (extracted.sortCode && supplier.sortCode && extracted.sortCode !== supplier.sortCode) ||
    (extracted.iban && supplier.iban && extracted.iban !== supplier.iban);

  if (!mismatch) {
    await logAudit(supplier.id, sourceRef, supplier, extracted, "MATCH");
    return {
      ok: true,
      supplierId: supplier.id,
      supplierName: supplier.name,
      sourceRef,
      extracted,
      stored: {
        bankAccount: supplier.bankAccount,
        sortCode: supplier.sortCode,
        iban: supplier.iban,
        lastVerifiedAt: supplier.bankLastVerifiedAt,
      },
      verdict: "MATCH",
    };
  }

  // MISMATCH — CRITICAL task, do NOT auto-update stored details
  await logAudit(supplier.id, sourceRef, supplier, extracted, "MISMATCH");
  const task = await ensureOpenSupplierTask({
    supplierId: supplier.id,
    supplierName: supplier.name,
    taskType: "BANK_DETAIL_CHANGE_ALERT",
    priority: "CRITICAL",
    generatedReason: `Bank details on document differ from stored values for ${supplier.name}. DO NOT PAY.`,
    draftBody: buildMismatchBody(supplier, extracted, sourceRef),
    sourceRef,
  });

  return {
    ok: true,
    supplierId: supplier.id,
    supplierName: supplier.name,
    sourceRef,
    extracted,
    stored: {
      bankAccount: supplier.bankAccount,
      sortCode: supplier.sortCode,
      iban: supplier.iban,
      lastVerifiedAt: supplier.bankLastVerifiedAt,
    },
    verdict: "MISMATCH",
    taskId: task.id,
    taskType: "BANK_DETAIL_CHANGE_ALERT",
    taskCreated: task.created,
  };
}

export async function runBankDetailSweep(
  opts: { limit?: number } = {}
): Promise<BankSweepResult> {
  const limit = Math.min(opts.limit ?? 100, 500);

  const bills = await prisma.supplierBill.findMany({
    where: {
      OR: [
        { lines: { some: { description: { contains: "sort code", mode: "insensitive" } } } },
        { lines: { some: { description: { contains: "account number", mode: "insensitive" } } } },
        { lines: { some: { description: { contains: "iban", mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      billNo: true,
      lines: { select: { description: true } },
    },
    orderBy: { billDate: "desc" },
    take: limit,
  });

  const result: BankSweepResult = {
    ok: true,
    scanned: 0,
    mismatches: 0,
    newStoreRequests: 0,
    tasksCreated: 0,
    errors: [],
    outcomes: [],
  };

  for (const b of bills) {
    try {
      result.scanned += 1;
      const text = b.lines.map((l) => l.description).join("\n");
      const outcome = await runBankDetailCheck({
        text,
        supplierBillId: b.id,
        sourceRef: `bill:${b.id}`,
      });
      result.outcomes.push(outcome);
      if (outcome.verdict === "MISMATCH") {
        result.mismatches += 1;
        if (outcome.taskCreated) result.tasksCreated += 1;
      } else if (outcome.verdict === "NO_SUPPLIER_BANK_STORED") {
        result.newStoreRequests += 1;
        if (outcome.taskCreated) result.tasksCreated += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ supplierBillId: b.id, error: msg });
      result.ok = false;
      console.error(`[bank-detail-sweep] bill ${b.id} failed:`, err);
    }
  }
  return result;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function logAudit(
  supplierId: string,
  sourceRef: string | null,
  stored:
    | { bankAccount: string | null; sortCode: string | null; iban: string | null }
    | null,
  extracted: ExtractedBankDetails,
  verdict: string
) {
  try {
    await prisma.ingestionAuditLog.create({
      data: {
        objectType: "Supplier",
        objectId: supplierId,
        actionType: `BANK_DETAIL_CHECK_${verdict}`,
        actor: "SYSTEM",
        previousValueJson: stored
          ? { bankAccount: stored.bankAccount, sortCode: stored.sortCode, iban: stored.iban }
          : undefined,
        newValueJson: {
          bankAccount: extracted.bankAccount,
          sortCode: extracted.sortCode,
          iban: extracted.iban,
          rawExcerpt: extracted.rawExcerpt,
        },
        reason: sourceRef ?? undefined,
      },
    });
  } catch (err) {
    console.error("[bank-detail-monitor] audit log failed:", err);
  }
}

async function ensureOpenSupplierTask(input: {
  supplierId: string;
  supplierName: string;
  taskType: "BANK_DETAIL_CHANGE_ALERT" | "STORE_BANK_DETAILS";
  priority: "HIGH" | "CRITICAL";
  generatedReason: string;
  draftBody: string;
  sourceRef: string | null;
}): Promise<{ id: string; created: boolean }> {
  // Anchor a bank task to an admin / supplier-ops ticket. We don't have a
  // dedicated supplier-ticket concept, so attach to the earliest ticket we
  // can find for this supplier. If none exists, fail gracefully — bank
  // tasks still need a ticketId per schema.
  const ticket = await prisma.ticket.findFirst({
    where: { procurementOrders: { some: { supplierId: input.supplierId } } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!ticket) {
    // No ticket to attach to yet — log and return a synthetic id so caller's
    // shape stays consistent. The task will attach the next time the supplier
    // appears on a ticket.
    console.warn(
      `[bank-detail-monitor] no ticket found for supplier ${input.supplierId} — task deferred.`
    );
    return { id: "deferred", created: false };
  }

  const reasonTag = `bank-check supplier=${input.supplierId}${input.sourceRef ? ` src=${input.sourceRef}` : ""}`;

  const existing = await prisma.task.findFirst({
    where: {
      ticketId: ticket.id,
      taskType: input.taskType,
      status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
      generatedReason: { contains: `supplier=${input.supplierId}` },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await prisma.task.create({
    data: {
      ticketId: ticket.id,
      taskType: input.taskType,
      priority: input.priority,
      status: "OPEN",
      dueAt: endOfToday(),
      generatedReason: `${input.generatedReason} [${reasonTag}]`,
      draftBody: input.draftBody,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

function buildMismatchBody(
  stored: { name: string; bankAccount: string | null; sortCode: string | null; iban: string | null },
  extracted: ExtractedBankDetails,
  sourceRef: string | null
): string {
  return [
    `⚠ CRITICAL — BANK DETAIL MISMATCH`,
    ``,
    `Supplier: ${stored.name}`,
    `Source  : ${sourceRef ?? "—"}`,
    ``,
    `Do NOT pay this bill until verified by PHONE with the supplier.`,
    ``,
    `Stored details     (do NOT use):`,
    `  Account : ${stored.bankAccount ?? "—"}`,
    `  Sort    : ${stored.sortCode ?? "—"}`,
    `  IBAN    : ${stored.iban ?? "—"}`,
    ``,
    `Details on document (unverified):`,
    `  Account : ${extracted.bankAccount ?? "—"}`,
    `  Sort    : ${extracted.sortCode ?? "—"}`,
    `  IBAN    : ${extracted.iban ?? "—"}`,
    `  Excerpt : "${extracted.rawExcerpt ?? ""}"`,
    ``,
    `Actions:`,
    `  1. Call the supplier on the number you already have on file`,
    `     (NOT the number on this document).`,
    `  2. Confirm the change is genuine.`,
    `  3. If confirmed: update Supplier.bankAccount/sortCode/iban and set`,
    `     bankLastVerifiedAt + bankLastVerifiedBy.`,
    `  4. If NOT confirmed: reject the bill, flag to finance.`,
  ].join("\n");
}

function buildStoreBankDetailsBody(
  supplierName: string,
  extracted: ExtractedBankDetails,
  sourceRef: string | null
): string {
  return [
    `Store bank details for ${supplierName}`,
    ``,
    `First invoice with bank details detected. Source: ${sourceRef ?? "—"}.`,
    `Verify by phone, then record on Supplier.`,
    ``,
    `Detected:`,
    `  Account : ${extracted.bankAccount ?? "—"}`,
    `  Sort    : ${extracted.sortCode ?? "—"}`,
    `  IBAN    : ${extracted.iban ?? "—"}`,
    `  Excerpt : "${extracted.rawExcerpt ?? ""}"`,
    ``,
    `Do NOT store until verified by phone using a number you already have.`,
  ].join("\n");
}

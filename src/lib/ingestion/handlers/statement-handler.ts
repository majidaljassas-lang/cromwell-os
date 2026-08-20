/**
 * Statement → AP reconciler (Universal Ingestion, Phase B step 1)
 *
 * A supplier statement summarises invoices that supplier believes we owe.
 * It does NOT create new bills — it reconciles existing ones. Pipeline:
 *
 *   1. Extract candidate bill references from the statement text
 *   2. For each reference, look up an existing SupplierBill (billNo match)
 *   3. Persist IntakeDocument (docType=STATEMENT) with the full reconciliation
 *      payload in `extracted` — every ref + match status, queryable end-to-end
 *   4. Open one STATEMENT_RECONCILED task summarising the result
 *   5. For each unmatched ref, open STATEMENT_UNMATCHED_BILL with
 *      closesOnSignal so when the missing bill later arrives it auto-resolves
 *
 * v1: billNo-only match (no supplier resolution). Refinement (supplier scope,
 * amount/date corroboration, fuzzy billNo) can land doctype-handler-side
 * without engine changes.
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";

interface StatementMatch {
  ref: string;
  matched: boolean;
  /** Source of the match: native SupplierBill, historical ZohoImportedBill, or null when unmatched. */
  source?: "NATIVE" | "ZOHO_IMPORTED";
  billId?: string;
  supplierId?: string;
  paymentStatus?: string;
}

// Regex captures everything plausible. Garbage is filtered post-capture by
// isLikelyBillRef — easier to read and maintain than ever-more-baroque regex.
const REF_PATTERNS: RegExp[] = [
  /\b(?:INV|INVOICE|BILL)[-\s.#:]?([A-Z0-9][A-Z0-9-_/]{2,20})\b/gi,
  /\b(\d{6,12})\b/g,                       // long pure-digit invoice numbers
  /\b([A-Z]{2,5}[-/]\d{3,10})\b/g,         // PREFIX-NNNNN style
  /\b(\d{1,4}[-/][A-Z]?\d{2,8})\b/g,       // 2434/457 style (mirrors Boyden)
  // PDF table extractors often glue columns: "30.05.20269002466249" rather
  // than "30.05.2026 9002466249". Capture digit runs that follow a 4-digit
  // year (2018-2030) — works when the year is the only delimiter the engine
  // can see between the date and the invoice number.
  /(?:20[12][0-9])(\d{6,12})\b/g,
];

// Word fragments produced when the regex slices through "INVOICE" / "INVOICES" /
// "INVOICING" etc. ("INV" itself is a real prefix and stays).
const WORD_FRAGMENT_GARBAGE = new Set([
  "OICE", "OICES", "OICING", "ICES", "ICING", "ING", "OICE.",
  "STATEMENT", "STATEMENTS", "ACCOUNT", "TOTAL", "BALANCE", "DATE", "REF",
]);

/**
 * Filter out captured strings that aren't plausibly invoice numbers. Errs on
 * the side of letting potential refs through — better to keep an iffy chase
 * task than miss a real one.
 */
function isLikelyBillRef(raw: string): boolean {
  const ref = raw.toUpperCase();
  if (WORD_FRAGMENT_GARBAGE.has(ref)) return false;

  // Year-month stamps (2026-05) and day/month stamps (30/04, 04/2026). Real
  // invoice numbers won't look like these in isolation.
  if (/^\d{4}-\d{1,2}$/.test(ref)) return false;          // 2026-05
  if (/^\d{1,2}[-/]\d{1,2}$/.test(ref)) return false;     // 30/04, 30-04
  if (/^\d{1,2}[-/]\d{4}$/.test(ref)) return false;       // 04/2026
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(ref)) return false;
  // Net-terms / age-bucket pairs ("60-09", "30-04", "20-39")
  if (/^\d{1,2}-\d{1,2}$/.test(ref) && ref.length <= 5) return false;
  // 4–5 char ALL-CAPS letters with no digits (word tails like SCRA, UCH)
  if (/^[A-Z]{2,5}$/.test(ref)) return false;
  // Pure-digit refs shorter than 5 chars are too generic to chase usefully
  if (/^\d{1,4}$/.test(ref)) return false;
  return true;
}

function extractCandidateRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const pattern of REF_PATTERNS) {
    let m: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((m = pattern.exec(text)) !== null) {
      const ref = m[1].trim().toUpperCase();
      if (ref.length < 3 || ref.length > 24) continue;
      if (!isLikelyBillRef(ref)) continue;
      refs.add(ref);
    }
  }
  return Array.from(refs);
}

async function matchRefToBill(
  ref: string,
  supplierId: string | null,
  supplierName: string | null,
): Promise<StatementMatch> {
  // 1. Native SupplierBill — preferred. Scoped to supplier when known.
  const supplierFilter = supplierId ? { supplierId } : {};
  const bill = await prisma.supplierBill.findFirst({
    where: {
      ...supplierFilter,
      OR: [
        { billNo: ref },
        { billNo: { equals: ref, mode: "insensitive" } },
        { billNo: { endsWith: ref, mode: "insensitive" } },
      ],
    },
    select: { id: true, billNo: true, supplierId: true, paymentStatus: true },
    orderBy: { createdAt: "desc" },
  });

  if (bill) {
    return {
      ref,
      matched: true,
      source: "NATIVE",
      billId: bill.id,
      supplierId: bill.supplierId,
      paymentStatus: bill.paymentStatus ?? undefined,
    };
  }

  // 2. ZohoImportedBill fallback — most pre-cutover bills live here, not in
  //    the native table. No FK to Supplier, so scope by vendorName when we have
  //    a supplier name, otherwise search globally.
  const vendorFilter = supplierName
    ? { vendorName: { contains: supplierName, mode: "insensitive" as const } }
    : {};
  const zoho = await prisma.zohoImportedBill.findFirst({
    where: {
      ...vendorFilter,
      OR: [
        { zohoNumber: ref },
        { zohoNumber: { equals: ref, mode: "insensitive" } },
        { zohoNumber: { endsWith: ref, mode: "insensitive" } },
      ],
    },
    select: { id: true, zohoNumber: true, status: true, vendorName: true },
    orderBy: { importedAt: "desc" },
  });

  if (zoho) {
    return {
      ref,
      matched: true,
      source: "ZOHO_IMPORTED",
      billId: zoho.id,
      supplierId: supplierId ?? undefined,
      paymentStatus: zoho.status ?? undefined,
    };
  }

  return { ref, matched: false };
}

/**
 * Best-effort supplier resolution from the statement sender, no side effects:
 *   1. EMAIL_DOMAIN alias  (e.g. domain "boyden.co.uk" → Boyden & Co)
 *   2. Email exact match in alias table
 *   3. Supplier name fuzzy by sender display name
 * Returns null if nothing sticks — handler runs with global scope.
 */
async function resolveStatementSupplier(fromEmail: string, fromName: string): Promise<string | null> {
  const email = fromEmail.toLowerCase().trim();
  const domain = email.match(/@([^\s>]+)/)?.[1];

  if (domain) {
    const aliasByDomain = await prisma.supplierAlias.findFirst({
      where: { source: "EMAIL_DOMAIN", alias: { equals: domain, mode: "insensitive" } },
      select: { supplierId: true },
    });
    if (aliasByDomain) return aliasByDomain.supplierId;
  }

  if (email) {
    const aliasByEmail = await prisma.supplierAlias.findFirst({
      where: { alias: { equals: email, mode: "insensitive" } },
      select: { supplierId: true },
    });
    if (aliasByEmail) return aliasByEmail.supplierId;
  }

  if (fromName?.trim()) {
    const exact = await prisma.supplier.findFirst({
      where: { name: { equals: fromName.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (exact) return exact.id;
  }

  return null;
}

export const handleStatement: TriggerHandler = async (ctx) => {
  const fullText = `${ctx.subject}\n${ctx.text}`;
  const candidateRefs = extractCandidateRefs(fullText);

  const supplierId = await resolveStatementSupplier(ctx.fromEmail, ctx.fromName);
  let supplierName: string | null = null;
  if (supplierId) {
    const s = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });
    supplierName = s?.name ?? null;
  }

  const matches = await Promise.all(candidateRefs.map((r) => matchRefToBill(r, supplierId, supplierName)));
  const matched = matches.filter((m) => m.matched);
  const unmatched = matches.filter((m) => !m.matched);

  // Persist the statement as a queryable IntakeDocument. All extracted data
  // lives in the DB — never on disk.
  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_STATEMENT",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "STATEMENT",
      intent: "REACTION",
      intentConfidence: 90,
      status: "PARSED",
      extracted: JSON.parse(
        JSON.stringify({
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
          supplierId,
          candidateRefs,
          matches,
          summary: {
            totalRefs: candidateRefs.length,
            matched: matched.length,
            unmatched: unmatched.length,
          },
        }),
      ),
      triggerStatus: "FIRED",
    },
  });

  // Anchor the summary task to the most recent ticket so it surfaces in the
  // queue (Task.ticketId is required). Future iteration can attach to a
  // dedicated AP review queue instead.
  const anchorTicket = await prisma.ticket.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  const tasksCreated: string[] = [];
  if (anchorTicket) {
    const summaryTask = await prisma.task.create({
      data: {
        ticketId: anchorTicket.id,
        taskType: "STATEMENT_RECONCILED",
        priority: unmatched.length > 0 ? "HIGH" : "MEDIUM",
        status: "OPEN",
        generatedReason:
          `Statement from ${ctx.fromEmail || ctx.fromName || "supplier"}: ` +
          `${matched.length}/${candidateRefs.length} refs matched, ` +
          `${unmatched.length} unmatched`,
      },
    });
    tasksCreated.push(summaryTask.id);

    for (const u of unmatched) {
      const matcher: Record<string, string> = { billNo: u.ref };
      // When we know the supplier, scope the matcher so a bill from a
      // different supplier with the same number can't false-close this task.
      if (supplierId) matcher.supplierId = supplierId;
      const t = await prisma.task.create({
        data: {
          ticketId: anchorTicket.id,
          taskType: "STATEMENT_UNMATCHED_BILL",
          priority: "HIGH",
          status: "OPEN",
          generatedReason: `Supplier statement references invoice ${u.ref} but no matching SupplierBill exists. Chase the bill.`,
          closesOnSignal: {
            docType: "BILL_DOCUMENT",
            matcher,
          },
        },
      });
      tasksCreated.push(t.id);
    }
  }

  await prisma.intakeDocument.update({
    where: { id: intake.id },
    data: { linkedTaskId: tasksCreated[0] ?? null },
  });

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "STATEMENT_RECONCILED",
    newValue: {
      eventId: ctx.eventId,
      totalRefs: candidateRefs.length,
      matched: matched.length,
      unmatched: unmatched.length,
      tasksCreated: tasksCreated.length,
    },
    reason: `Reconciled supplier statement; ${unmatched.length} missing bills queued for chase`,
  });

  await prisma.ingestionEvent.update({
    where: { id: ctx.eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId: ctx.eventId,
    action: "STATEMENT_RECONCILED",
    success: true,
    details: `${matched.length}/${candidateRefs.length} matched, ${unmatched.length} unmatched, ${tasksCreated.length} tasks`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("STATEMENT", "REACTION", handleStatement);

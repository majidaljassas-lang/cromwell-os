/**
 * Credit Note → allocator (Universal Ingestion, Phase B step 3)
 *
 * Schema (CreditNote, CreditNoteAllocation) exists but no pipeline. v1 wires
 * intake + signal-emit; full allocation to ReturnLine is a follow-up.
 *
 * Pipeline:
 *   1. extractFromText → structured.documentRef (credit note no), total, lines
 *   2. Resolve supplier from sender domain / extracted supplierName
 *   3. Persist IntakeDocument(docType=CREDIT_NOTE)
 *   4. Create CreditNote row when supplier + creditNoteNo are known
 *   5. Try to find the original SupplierBill being credited (via line references)
 *   6. Emit CREDIT_NOTE signal → resolveTasksForSignal closes Task(AWAITING_CREDIT)
 *   7. Open Task(CREDIT_NEEDS_ALLOCATION) for human to map to specific returns
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { resolveTasksForSignal } from "@/lib/ingestion/signal-resolver";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";
import { extractFromText } from "@/lib/ingestion/extract-any";

async function resolveSupplier(
  fromEmail: string,
  fromName: string,
  extractedName: string | null,
): Promise<{ id: string; name: string } | null> {
  const domain = (fromEmail.split("@")[1] || "").toLowerCase().split(".")[0];
  const candidates = [extractedName, fromName, domain].filter(Boolean) as string[];
  for (const cand of candidates) {
    const supplier = await prisma.supplier.findFirst({
      where: { name: { contains: cand, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (supplier) return supplier;
  }
  return null;
}

function extractOriginalBillRefs(text: string): string[] {
  const refs = new Set<string>();
  const patterns: RegExp[] = [
    /\b(?:original|against|re:|ref(?:erence)?:?\s*invoice|invoice)\s*[#:]?\s*([A-Z0-9][A-Z0-9-/]{2,20})/gi,
    /\bcredit\s+for\s+(?:invoice|inv)\s*[#:]?\s*([A-Z0-9][A-Z0-9-/]{2,20})/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const ref = m[1].trim().toUpperCase();
      if (ref.length >= 3 && ref.length <= 24) refs.add(ref);
    }
  }
  return Array.from(refs);
}

export const handleCreditNote: TriggerHandler = async (ctx) => {
  const extracted = await extractFromText(`${ctx.subject}\n${ctx.text}`);
  const doc = extracted.structured;
  const supplier = await resolveSupplier(ctx.fromEmail, ctx.fromName, doc.supplierName);
  const originalBillRefs = extractOriginalBillRefs(`${ctx.subject}\n${ctx.text}`);

  // Try to find the original bill being credited
  let originalBillId: string | null = null;
  if (originalBillRefs.length > 0 && supplier) {
    const original = await prisma.supplierBill.findFirst({
      where: {
        supplierId: supplier.id,
        billNo: { in: originalBillRefs },
      },
      select: { id: true },
    });
    originalBillId = original?.id ?? null;
  }

  // Persist intake — full extraction always lands in DB even when supplier
  // resolution or credit-note creation fails downstream.
  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_CREDIT_NOTE",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "CREDIT_NOTE",
      intent: "REACTION",
      intentConfidence: doc.documentRef ? 80 : 60,
      status: "PARSED",
      extracted: JSON.parse(
        JSON.stringify({
          parsed: {
            documentRef: doc.documentRef,
            documentDate: doc.documentDate,
            supplierName: doc.supplierName,
            total: doc.total,
            subtotal: doc.subtotal,
            vatAmount: doc.vatAmount,
            lines: doc.lines,
          },
          originalBillRefs,
          originalBillId,
          resolvedSupplierId: supplier?.id ?? null,
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
        }),
      ),
      triggerStatus: "FIRED",
    },
  });

  // Persist a CreditNote row when we have enough info. Always attempt this so
  // the credit shows in supplier ledgers, even before allocation.
  let creditNoteId: string | null = null;
  if (supplier && doc.documentRef) {
    const existing = await prisma.creditNote.findFirst({
      where: { supplierId: supplier.id, creditNoteNo: doc.documentRef },
      select: { id: true },
    });
    if (existing) {
      creditNoteId = existing.id;
    } else {
      const cn = await prisma.creditNote.create({
        data: {
          supplierId: supplier.id,
          creditNoteNo: doc.documentRef,
          dateReceived: doc.documentDate ? new Date(doc.documentDate) : new Date(),
          totalCredit: doc.total ?? doc.subtotal ?? 0,
          status: "RECEIVED",
          sourceAttachmentRef: intake.id,
        },
      });
      creditNoteId = cn.id;
    }
  }

  // Open allocation task on the most recent ticket for the supplier (if known)
  // or any ticket as a placeholder. Allocation to specific ReturnLines is
  // a follow-up — v1 just makes sure no credit goes missing.
  const anchorTicket = supplier
    ? await prisma.ticket.findFirst({
        where: {
          OR: [
            { procurementOrders: { some: { supplierId: supplier.id } } },
            { returns: { some: { supplierId: supplier.id } } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : await prisma.ticket.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });

  const tasksCreated: string[] = [];
  if (anchorTicket && creditNoteId) {
    const t = await prisma.task.create({
      data: {
        ticketId: anchorTicket.id,
        taskType: "CREDIT_NEEDS_ALLOCATION",
        priority: "MEDIUM",
        status: "OPEN",
        generatedReason:
          `Credit note ${doc.documentRef} from ${supplier?.name ?? "supplier"} ` +
          `for £${doc.total ?? "?"} — allocate to a specific return.`,
      },
    });
    tasksCreated.push(t.id);
  }

  // Emit signal so any Task(AWAITING_CREDIT) keyed to this supplier auto-closes.
  const signalMatcher: Record<string, string | undefined> = {
    creditNoteNo: doc.documentRef ?? undefined,
    supplierId: supplier?.id,
    originalBillId: originalBillId ?? undefined,
  };
  for (const ref of originalBillRefs) signalMatcher[`originalBillNo:${ref}`] = ref;

  const resolveResult = await resolveTasksForSignal({
    docType: "CREDIT_NOTE",
    matcher: signalMatcher,
    source: intake.id,
  });

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "CREDIT_NOTE_RECEIVED",
    newValue: {
      eventId: ctx.eventId,
      creditNoteId,
      supplierId: supplier?.id ?? null,
      originalBillId,
      total: doc.total ?? null,
      autoClosedTasks: resolveResult.closedTaskIds.length,
    },
    reason: creditNoteId
      ? `Credit note ${doc.documentRef} persisted; ${resolveResult.closedTaskIds.length} awaiting-credit tasks closed`
      : "Credit note received but supplier or ref unresolved — review needed",
  });

  await prisma.ingestionEvent.update({
    where: { id: ctx.eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId: ctx.eventId,
    action: "CREDIT_NOTE",
    success: true,
    details:
      `creditNoteRef=${doc.documentRef ?? "?"} supplier=${supplier?.name ?? "?"} ` +
      `total=${doc.total ?? "?"} auto-closed=${resolveResult.closedTaskIds.length}`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("CREDIT_NOTE", "REACTION", handleCreditNote);

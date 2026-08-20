/**
 * Customer PO → universal pipeline (Universal Ingestion, Phase C step 1)
 *
 * Customer POs already had a working handler (handlePODocument in
 * auto-action.ts) — Yesss template + AI fallback, builds CustomerPO + lines +
 * supplier PO drafts. This wrapper plugs that proven flow into the universal
 * pipeline so POs get the same observability + auto-close behaviour as every
 * other doctype:
 *
 *   1. Write IntakeDocument(docType=PO_DOCUMENT, intent=ACTION) up front so
 *      the artefact is queryable in the universal table even before parsing
 *   2. Delegate to handlePODocument — the working logic is untouched
 *   3. Look up the resulting CustomerPO via poNo and back-fill IntakeDocument
 *   4. Emit PO_DOCUMENT signal so any Task(AWAITING_CUSTOMER_PO) declared on
 *      a Quote/ticket auto-closes
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { resolveTasksForSignal } from "@/lib/ingestion/signal-resolver";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";
import { handlePODocument, extractPONumber } from "@/lib/ingestion/auto-action";

export const handlePODocumentRegistry: TriggerHandler = async (ctx) => {
  // Stage 1: pre-write IntakeDocument so the artefact is captured even if
  // downstream parsing fails. Status starts PENDING; back-filled on success.
  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_CUSTOMER_PO",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "PO_DOCUMENT",
      intent: "ACTION",
      intentConfidence: 80,
      status: "NEW",
      extracted: JSON.parse(
        JSON.stringify({
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
          poNo: extractPONumber(ctx.subject, ctx.text),
        }),
      ),
      triggerStatus: "PENDING",
    },
  });

  // Stage 2: delegate to the proven handler. It creates CustomerPO + lines,
  // resolves customer/site/ticket, generates supplier PO drafts, sets
  // ingestionEvent.status = ACTIONED.
  const legacy = await handlePODocument(ctx.eventId, ctx.subject, ctx.text, ctx.fromEmail, ctx.fromName);

  // Stage 3: locate the CustomerPO that was just created (or enriched) and
  // back-fill the IntakeDocument so the universal table mirrors the truth.
  const poNo = extractPONumber(ctx.subject, ctx.text);
  let customerPO: {
    id: string;
    ticketId: string | null;
    customerId: string;
    siteId: string;
    poNo: string;
    quoteId: string | null;
    totalValue: unknown;
  } | null = null;
  if (poNo) {
    customerPO = await prisma.customerPO.findFirst({
      where: { poNo },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        ticketId: true,
        customerId: true,
        siteId: true,
        poNo: true,
        quoteId: true,
        totalValue: true,
      },
    });
  }

  await prisma.intakeDocument.update({
    where: { id: intake.id },
    data: {
      status: legacy.success ? "PARSED" : "ERROR",
      triggerStatus: legacy.success ? "FIRED" : "FAILED",
      errorMessage: legacy.success ? null : legacy.details,
      linkedTicketId: customerPO?.ticketId ?? null,
      extracted: JSON.parse(
        JSON.stringify({
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
          poNo,
          legacyDetails: legacy.details,
          customerPOId: customerPO?.id ?? null,
          customerId: customerPO?.customerId ?? null,
          siteId: customerPO?.siteId ?? null,
          ticketId: customerPO?.ticketId ?? null,
          quoteId: customerPO?.quoteId ?? null,
          totalValue: customerPO?.totalValue ?? null,
        }),
      ),
    },
  });

  // Stage 4: emit signal — closes any Task(AWAITING_CUSTOMER_PO) declared on
  // a Quote that was waiting for the PO to land.
  const signalMatcher: Record<string, string | undefined> = {
    poNo: poNo ?? undefined,
    customerPOId: customerPO?.id,
    customerId: customerPO?.customerId,
    ticketId: customerPO?.ticketId ?? undefined,
    quoteId: customerPO?.quoteId ?? undefined,
  };
  const resolveResult = await resolveTasksForSignal({
    docType: "PO_DOCUMENT",
    matcher: signalMatcher,
    source: intake.id,
  });

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "PO_RECEIVED",
    newValue: {
      eventId: ctx.eventId,
      poNo,
      customerPOId: customerPO?.id ?? null,
      ticketId: customerPO?.ticketId ?? null,
      legacyAction: legacy.action,
      legacySuccess: legacy.success,
      autoClosedTasks: resolveResult.closedTaskIds.length,
    },
    reason: customerPO
      ? `Customer PO ${poNo} ingested → CustomerPO ${customerPO.id}; ${resolveResult.closedTaskIds.length} awaiting-PO tasks closed`
      : `Customer PO event processed but no CustomerPO row found by poNo=${poNo ?? "?"}`,
  });

  return {
    eventId: ctx.eventId,
    action: legacy.action,
    success: legacy.success,
    details: `${legacy.details} · intake=${intake.id} · auto-closed=${resolveResult.closedTaskIds.length}`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("PO_DOCUMENT", "ACTION", handlePODocumentRegistry);

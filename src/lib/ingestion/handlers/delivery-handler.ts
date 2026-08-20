/**
 * Delivery Update → stopStatus + line match (Universal Ingestion, Phase B step 4)
 *
 * Closes the gap flagged in AGENTS.md: "no code currently parses supplier
 * delivery emails to write LogisticsEvent.stopStatus." This handler does that.
 *
 * Pipeline:
 *   1. Detect delivery state from subject+body (DELIVERED / DEPARTED / NOT_ARRIVED)
 *   2. Extract tracking ref + PO ref + delivery date if present
 *   3. Resolve ticket via PO ref → ProcurementOrder.ticketId
 *   4. Persist IntakeDocument(docType=DELIVERY_NOTE)
 *   5. Find or create LogisticsEvent for the ticket; set stopStatus +
 *      deliveredAt + processedAt + cpRef
 *   6. Emit DELIVERY_UPDATE signal → close any Task(AWAITING_DELIVERY)
 *
 * Photos / scanned PODs land via the IntakeDocument.rawText (OCR happens
 * upstream in extractAny when the artefact is an image). All evidence is
 * queryable, never on disk only.
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { resolveTasksForSignal } from "@/lib/ingestion/signal-resolver";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";

type StopStatus = "DELIVERED" | "DEPARTED" | "NOT_ARRIVED" | "BYPASSED" | "UNKNOWN";

const STATUS_PATTERNS: Array<{ status: StopStatus; re: RegExp }> = [
  { status: "DELIVERED",   re: /\b(delivered|on site|arrived on site|dropped off|completed delivery|signed for|pod attached)\b/i },
  { status: "DEPARTED",    re: /\b(dispatched|despatched|out for delivery|in transit|shipped|on its way|loaded on(?:to)? (?:van|truck))\b/i },
  { status: "NOT_ARRIVED", re: /\b(not delivered|missed delivery|failed delivery|redelivery required|delayed)\b/i },
  { status: "BYPASSED",    re: /\b(bypassed|skipped stop|did not attend)\b/i },
];

function detectStatus(text: string): StopStatus {
  for (const { status, re } of STATUS_PATTERNS) {
    if (re.test(text)) return status;
  }
  return "UNKNOWN";
}

function extractPoRef(text: string): string | null {
  const m =
    text.match(/\bPO[-\s#:]?([A-Z0-9-/]{3,20})/i) ||
    text.match(/\bP\.?O\.?\s*(?:no|number|ref)?\s*[:#]?\s*([A-Z0-9-/]{3,20})/i) ||
    text.match(/\border[-\s#:]?(\d{4,})/i);
  return m ? m[1].trim() : null;
}

function extractTrackingRef(text: string): string | null {
  const m =
    text.match(/\btracking\s*(?:no|number|ref|#)?\s*[:#]?\s*([A-Z0-9-]{6,30})/i) ||
    text.match(/\b(consignment|cpref)\s*[:#]?\s*([A-Z0-9-]{6,30})/i);
  return m ? (m[2] ?? m[1]).trim() : null;
}

function extractDate(text: string): Date | null {
  const m =
    text.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/) ||
    text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (!m) return null;
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function resolveTicketViaPoRef(poRef: string): Promise<{ ticketId: string; procurementOrderId: string } | null> {
  const po = await prisma.procurementOrder.findFirst({
    where: { OR: [{ poNo: poRef }, { supplierRef: poRef }] },
    select: { id: true, ticketId: true },
  });
  return po ? { ticketId: po.ticketId, procurementOrderId: po.id } : null;
}

async function resolveTicketViaSiteOrSubject(text: string): Promise<string | null> {
  // Cheap fallback: match site name in text.
  const sites = await prisma.site.findMany({ select: { id: true, siteName: true } });
  const lower = text.toLowerCase();
  for (const s of sites) {
    if (lower.includes(s.siteName.toLowerCase())) {
      const ticket = await prisma.ticket.findFirst({
        where: { siteId: s.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (ticket) return ticket.id;
    }
  }
  return null;
}

export const handleDelivery: TriggerHandler = async (ctx) => {
  const fullText = `${ctx.subject}\n${ctx.text}`;
  const status = detectStatus(fullText);
  const poRef = extractPoRef(fullText);
  const trackingRef = extractTrackingRef(fullText);
  const eventDate = extractDate(fullText) ?? new Date();

  const poResolved = poRef ? await resolveTicketViaPoRef(poRef) : null;
  const ticketId = poResolved?.ticketId ?? (await resolveTicketViaSiteOrSubject(fullText));

  // Persist intake regardless — the artefact must always land in DB.
  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_DELIVERY",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "DELIVERY_NOTE",
      intent: "REACTION",
      intentConfidence: status !== "UNKNOWN" ? 80 : 50,
      status: "PARSED",
      extracted: JSON.parse(
        JSON.stringify({
          status,
          poRef,
          trackingRef,
          eventDate: eventDate.toISOString(),
          procurementOrderId: poResolved?.procurementOrderId ?? null,
          ticketId,
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
        }),
      ),
      linkedTicketId: ticketId ?? null,
      triggerStatus: "FIRED",
    },
  });

  // Write the canonical LogisticsEvent the delivery tracker + 3-way match read.
  let logisticsEventId: string | null = null;
  if (ticketId && status !== "UNKNOWN") {
    // Prefer to update an existing pending LogisticsEvent for this ticket
    // (so we don't double-count); otherwise create a fresh one.
    const existing = await prisma.logisticsEvent.findFirst({
      where: {
        ticketId,
        OR: [{ stopStatus: null }, { stopStatus: "NOT_ARRIVED" }],
      },
      orderBy: { timestamp: "desc" },
      select: { id: true },
    });

    const baseData = {
      stopStatus: status as "DELIVERED" | "DEPARTED" | "NOT_ARRIVED" | "BYPASSED",
      deliveredAt: status === "DELIVERED" ? eventDate : null,
      processedAt: new Date(),
      cpRef: trackingRef ?? undefined,
    };

    if (existing) {
      await prisma.logisticsEvent.update({ where: { id: existing.id }, data: baseData });
      logisticsEventId = existing.id;
    } else {
      const created = await prisma.logisticsEvent.create({
        data: {
          ticketId,
          eventType: "DELIVERY_UPDATE",
          timestamp: eventDate,
          notes: `Auto-ingested ${status}; tracking=${trackingRef ?? "n/a"}`,
          attachmentRef: intake.id,
          ...baseData,
        },
      });
      logisticsEventId = created.id;
    }
  }

  // Emit signal so Task(AWAITING_DELIVERY) keyed to ticket / PO / tracking ref closes.
  const signalMatcher: Record<string, string | undefined> = {
    ticketId: ticketId ?? undefined,
    procurementOrderId: poResolved?.procurementOrderId,
    trackingRef: trackingRef ?? undefined,
    poRef: poRef ?? undefined,
  };
  const resolveResult =
    status === "DELIVERED"
      ? await resolveTasksForSignal({
          docType: "DELIVERY_UPDATE",
          matcher: signalMatcher,
          source: intake.id,
        })
      : { closedTaskIds: [], inspected: 0 };

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "DELIVERY_PROCESSED",
    newValue: {
      eventId: ctx.eventId,
      ticketId,
      procurementOrderId: poResolved?.procurementOrderId ?? null,
      logisticsEventId,
      status,
      autoClosedTasks: resolveResult.closedTaskIds.length,
    },
    reason: `Delivery ${status}; ${resolveResult.closedTaskIds.length} awaiting-delivery tasks closed`,
  });

  await prisma.ingestionEvent.update({
    where: { id: ctx.eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId: ctx.eventId,
    action: "DELIVERY_UPDATE",
    success: true,
    details:
      `status=${status} po=${poRef ?? "?"} ticket=${ticketId ?? "?"} ` +
      `logisticsEvent=${logisticsEventId ?? "n/a"} auto-closed=${resolveResult.closedTaskIds.length}`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("DELIVERY_UPDATE", "REACTION", handleDelivery);

/**
 * Supplier ACK → close awaiting-ACK loops (Universal Ingestion, Phase B step 2)
 *
 * A supplier order acknowledgement confirms a PO we sent. The parsed payload
 * (parseAckWithAI) gives us the supplier's own SO ref + every confirmed line.
 *
 * Pipeline:
 *   1. Parse via parseAckWithAI (AI extractor already in src/lib/procurement)
 *   2. Resolve our ProcurementOrder via ack.orderRef → ProcurementOrder.supplierRef
 *      OR via subject-line PO number → ProcurementOrder.poNo
 *   3. Persist IntakeDocument(docType=SUPPLIER_ORDER_ACK) with extracted payload
 *   4. Compare confirmed lines vs PO lines — if any price/qty drift, open
 *      Task(ACK_DISCREPANCY) on the linked ticket
 *   5. Emit SUPPLIER_ORDER_ACK signal so resolveTasksForSignal closes any
 *      open Task(AWAITING_ACK) declared with a matching closesOnSignal
 *
 * The legacy handleOrderAck in auto-action.ts still runs as fallback because
 * the registry-first dispatch only triggers when classification === SUPPLIER_ORDER_ACK.
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { resolveTasksForSignal } from "@/lib/ingestion/signal-resolver";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";
import { parseAckWithAI, type ParsedAIAck } from "@/lib/procurement/ai-ack-parser";

function extractPoFromSubject(subject: string): string | null {
  const m =
    subject.match(/\bPO[-\s#:]?([A-Z0-9-/]{3,20})/i) ||
    subject.match(/\bOrder[-\s#:]?([A-Z0-9-/]{3,20})/i) ||
    subject.match(/(\d{6,})/);
  return m ? m[1].trim() : null;
}

async function resolveProcurementOrder(ack: ParsedAIAck | null, subject: string) {
  // 1. supplier's own ref (orderRef) → our ProcurementOrder.supplierRef
  if (ack?.orderRef) {
    const po = await prisma.procurementOrder.findFirst({
      where: { supplierRef: ack.orderRef },
      select: { id: true, ticketId: true, supplierId: true, poNo: true, lines: true },
    });
    if (po) return { po, via: "supplierRef" as const };
  }
  // 2. our PO number from the subject → ProcurementOrder.poNo
  const fromSubject = extractPoFromSubject(subject);
  if (fromSubject) {
    const po = await prisma.procurementOrder.findFirst({
      where: { poNo: fromSubject },
      select: { id: true, ticketId: true, supplierId: true, poNo: true, lines: true },
    });
    if (po) return { po, via: "poNoFromSubject" as const };
  }
  return null;
}

interface DiscrepancyLine {
  description: string;
  poUnitCost: number | null;
  ackUnitCost: number;
  poQty: number | null;
  ackQty: number;
}

function findDiscrepancies(
  ack: ParsedAIAck,
  poLines: Array<{ description: string; qty: unknown; unitCost: unknown }>,
): DiscrepancyLine[] {
  const out: DiscrepancyLine[] = [];
  for (const ackLine of ack.lines) {
    const match = poLines.find((pl) =>
      pl.description.toLowerCase().includes(ackLine.description.toLowerCase().slice(0, 20)) ||
      ackLine.description.toLowerCase().includes(pl.description.toLowerCase().slice(0, 20)),
    );
    if (!match) continue;
    const poUnit = Number(match.unitCost as unknown as number) || null;
    const poQty = Number(match.qty as unknown as number) || null;
    const priceDrift = poUnit !== null && Math.abs(poUnit - ackLine.unitPrice) > 0.01;
    const qtyDrift = poQty !== null && Math.abs(poQty - ackLine.qty) > 0.001;
    if (priceDrift || qtyDrift) {
      out.push({
        description: ackLine.description,
        poUnitCost: poUnit,
        ackUnitCost: ackLine.unitPrice,
        poQty,
        ackQty: ackLine.qty,
      });
    }
  }
  return out;
}

export const handleAck: TriggerHandler = async (ctx) => {
  const ack = await parseAckWithAI(ctx.text);
  const resolved = await resolveProcurementOrder(ack, ctx.subject);

  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_ACK",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "SUPPLIER_ORDER_ACK",
      intent: "REACTION",
      intentConfidence: ack ? (ack.confidence === "HIGH" ? 90 : ack.confidence === "MEDIUM" ? 70 : 50) : 40,
      status: "PARSED",
      extracted: JSON.parse(
        JSON.stringify({
          parsed: ack,
          resolution: resolved
            ? { procurementOrderId: resolved.po.id, ticketId: resolved.po.ticketId, via: resolved.via }
            : null,
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
        }),
      ),
      linkedTicketId: resolved?.po.ticketId ?? null,
      triggerStatus: "FIRED",
    },
  });

  const tasksCreated: string[] = [];
  let discrepancies: DiscrepancyLine[] = [];

  if (resolved && ack) {
    discrepancies = findDiscrepancies(ack, resolved.po.lines);
    if (discrepancies.length > 0) {
      const t = await prisma.task.create({
        data: {
          ticketId: resolved.po.ticketId,
          taskType: "ACK_DISCREPANCY",
          priority: "HIGH",
          status: "OPEN",
          generatedReason:
            `Supplier ACK for PO ${resolved.po.poNo} drifts on ${discrepancies.length} line(s) — review before goods arrive.`,
          draftBody: JSON.stringify(discrepancies, null, 2),
        },
      });
      tasksCreated.push(t.id);
    }
  }

  // Emit signal so any open Task(AWAITING_ACK) auto-resolves.
  const signalMatcher: Record<string, string> = {};
  if (resolved) {
    signalMatcher.procurementOrderId = resolved.po.id;
    signalMatcher.poNo = resolved.po.poNo;
    signalMatcher.supplierId = resolved.po.supplierId;
  }
  if (ack?.orderRef) signalMatcher.supplierOrderRef = ack.orderRef;

  const resolveResult = await resolveTasksForSignal({
    docType: "SUPPLIER_ORDER_ACK",
    matcher: signalMatcher,
    source: intake.id,
  });

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "ACK_PROCESSED",
    newValue: {
      eventId: ctx.eventId,
      procurementOrderId: resolved?.po.id ?? null,
      lineCount: ack?.lines.length ?? 0,
      discrepancies: discrepancies.length,
      autoClosedTasks: resolveResult.closedTaskIds.length,
    },
    reason: resolved
      ? `ACK linked to PO ${resolved.po.poNo} via ${resolved.via}`
      : "ACK could not be linked to a known PO",
  });

  await prisma.ingestionEvent.update({
    where: { id: ctx.eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId: ctx.eventId,
    action: "SUPPLIER_ORDER_ACK",
    success: true,
    details:
      `parsed=${!!ack} po=${resolved?.po.poNo ?? "unmatched"} ` +
      `lines=${ack?.lines.length ?? 0} discrepancies=${discrepancies.length} ` +
      `auto-closed=${resolveResult.closedTaskIds.length}`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("SUPPLIER_ORDER_ACK", "REACTION", handleAck);

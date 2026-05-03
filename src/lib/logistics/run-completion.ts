/**
 * DeliveryRunStop completion → LogisticsEvent + PODDocument writer.
 *
 * Closes the stopStatus writer gap flagged in AGENTS.md:
 *   "no code currently parses supplier delivery emails to write
 *    LogisticsEvent.stopStatus. Delivery tracker + 3-way match remain
 *    dormant until a writer is added."
 *
 * When a stop is marked COMPLETED / FAILED:
 *   • Emits a LogisticsEvent with stopStatus + runStopId set
 *   • For DELIVER stops with signedByName: creates a PODDocument
 *     (linked back to the stop and the ticket — the POD data centre
 *     reads PODDocument directly)
 *   • Hands off to processLogisticsEvent so existing tracker side-effects
 *     fire (REDELIVERY_REQUIRED tasks, deliveryFailed flag, 3-way rematch)
 *
 * Idempotent: if a LogisticsEvent already exists for this stop, the writer
 * updates it instead of creating a duplicate.
 */

import { prisma } from "@/lib/prisma";
import { processLogisticsEvent } from "@/lib/logistics/delivery-tracker";

export interface CompleteStopInput {
  stopId: string;
  outcome: "COMPLETED" | "FAILED";
  signedByName?: string;
  notes?: string;
  podFileRef?: string;
  podFileName?: string;
  podMimeType?: string;
  uploadedBy?: string;
  arrivedAt?: Date;
  completedAt?: Date;
}

export interface CompleteStopResult {
  stopId: string;
  ticketId: string;
  logisticsEventId: string;
  podDocumentId: string | null;
  trackerActions: string[];
}

export async function completeStop(
  input: CompleteStopInput,
): Promise<CompleteStopResult> {
  const stop = await prisma.deliveryRunStop.findUnique({
    where: { id: input.stopId },
    include: {
      run: true,
      ticket: { select: { id: true, siteId: true } },
      site: true,
    },
  });
  if (!stop) throw new Error(`DeliveryRunStop not found: ${input.stopId}`);

  const now = new Date();
  const completedAt = input.completedAt ?? now;
  const arrivedAt = input.arrivedAt ?? stop.arrivedAt ?? completedAt;

  // 1. Update the stop itself
  await prisma.deliveryRunStop.update({
    where: { id: stop.id },
    data: {
      status: input.outcome,
      arrivedAt,
      completedAt,
      signedByName: input.signedByName ?? stop.signedByName,
      notes: input.notes ?? stop.notes,
    },
  });

  // 2. Create PODDocument for DELIVER stops with proof attached
  let podDocumentId: string | null = stop.podDocumentId;
  if (
    stop.type === "DELIVER" &&
    input.outcome === "COMPLETED" &&
    (input.signedByName || input.podFileRef)
  ) {
    if (!podDocumentId) {
      const podType = input.podFileRef
        ? input.podMimeType?.startsWith("image/")
          ? "IMAGE"
          : "DELIVERY_NOTE"
        : "SIGNED_RECEIPT";
      const pod = await prisma.pODDocument.create({
        data: {
          ticketId: stop.ticketId,
          podType,
          fileRef: input.podFileRef,
          fileName: input.podFileName,
          mimeType: input.podMimeType,
          signedBy: input.signedByName,
          signedAt: completedAt,
          notes: input.notes,
          uploadedBy: input.uploadedBy,
        },
      });
      podDocumentId = pod.id;
      await prisma.deliveryRunStop.update({
        where: { id: stop.id },
        data: { podDocumentId },
      });
    }
  }

  // 3. Emit / update the LogisticsEvent
  // For DELIVER: stopStatus tracks delivery success. For COLLECT: no stopStatus
  // (it's not a customer delivery), use eventType='GOODS_COLLECTED'.
  const stopStatus =
    stop.type === "DELIVER"
      ? input.outcome === "COMPLETED"
        ? "DELIVERED"
        : "NOT_ARRIVED"
      : null;
  const eventType =
    stop.type === "DELIVER"
      ? input.outcome === "COMPLETED"
        ? "GOODS_DELIVERED"
        : "DELIVERY_FAILED"
      : "GOODS_COLLECTED";

  const existing = await prisma.logisticsEvent.findFirst({
    where: { runStopId: stop.id },
  });

  let logisticsEventId: string;
  if (existing) {
    await prisma.logisticsEvent.update({
      where: { id: existing.id },
      data: {
        stopStatus,
        eventType,
        timestamp: completedAt,
        deliveredAt: stop.type === "DELIVER" && input.outcome === "COMPLETED" ? completedAt : null,
        deliveryAddress: stop.addressSnapshot,
        driver: stop.run.driverName,
        notes: input.notes ?? stop.notes,
        processedAt: null,
      },
    });
    logisticsEventId = existing.id;
  } else {
    const ev = await prisma.logisticsEvent.create({
      data: {
        ticketId: stop.ticketId,
        siteId: stop.siteId ?? stop.ticket.siteId,
        eventType,
        stopStatus,
        timestamp: completedAt,
        plannedDate: stop.timeWindowStart ?? stop.run.runDate,
        deliveredAt:
          stop.type === "DELIVER" && input.outcome === "COMPLETED"
            ? completedAt
            : null,
        deliveryAddress: stop.addressSnapshot,
        driver: stop.run.driverName,
        notes: input.notes ?? stop.notes,
        runStopId: stop.id,
      },
    });
    logisticsEventId = ev.id;
  }

  // 4. Hand off to delivery-tracker so all the existing side-effects fire
  // (REDELIVERY_REQUIRED, deliveryFailed flag, 3-way rematch). Only for DELIVER
  // stops — COLLECT events aren't deliveries to a customer.
  let trackerActions: string[] = [];
  if (stop.type === "DELIVER") {
    const result = await processLogisticsEvent(logisticsEventId, { force: true });
    trackerActions = result.actions;
  }

  // 5. Auto-roll the run to COMPLETED if every stop is terminal
  const remaining = await prisma.deliveryRunStop.count({
    where: {
      runId: stop.runId,
      status: { in: ["PENDING", "ARRIVED"] },
    },
  });
  if (remaining === 0 && stop.run.status === "DISPATCHED") {
    await prisma.deliveryRun.update({
      where: { id: stop.runId },
      data: { status: "COMPLETED", completedAt: now },
    });
  }

  return {
    stopId: stop.id,
    ticketId: stop.ticketId,
    logisticsEventId,
    podDocumentId,
    trackerActions,
  };
}

export async function dispatchRun(runId: string): Promise<void> {
  await prisma.deliveryRun.update({
    where: { id: runId },
    data: { status: "DISPATCHED", dispatchedAt: new Date() },
  });
}

export async function cancelRun(runId: string, reason?: string): Promise<void> {
  await prisma.deliveryRun.update({
    where: { id: runId },
    data: {
      status: "CANCELLED",
      notes: reason
        ? `${reason}`
        : undefined,
    },
  });
}

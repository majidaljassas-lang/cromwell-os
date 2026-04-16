/**
 * Phase 12 — Thread appender.
 *
 * Called from attachEventToThread() in thread-builder.ts AFTER a new
 * message is added to a thread that already has linkedTicketId set.
 *
 * Ensures every subsequent email/WhatsApp on a linked thread auto-appends
 * to the ticket without any user action:
 *   1. Creates an Event (COMMS_RECEIVED) on the linked ticket
 *   2. If message has attachments → creates EvidenceFragment
 *   3. If message contains approval/dispute/delivery signal → creates Task
 *
 * Respects manualMode on both thread and ticket.
 */

import { prisma } from "@/lib/prisma";
import { classifyMessage } from "@/lib/ingestion/classifier";

// ── Types ───────────────────────────────────────────────────────────────────

interface AppendContext {
  threadId: string;
  linkedTicketId: string;
  messageSnippet: string | null;
  sender: string | null;
  hasAttachments: boolean;
  occurredAt: Date;
  ingestionEventId: string;
  channel: string;
}

interface AppendResult {
  eventCreated: boolean;
  evidenceCreated: boolean;
  taskCreated: string | null; // taskType or null
}

// ── Channel → SourceType mapping ────────────────────────────────────────────

function channelToSourceType(channel: string): "OUTLOOK" | "WHATSAPP" | "EMAIL" {
  if (channel === "EMAIL") return "OUTLOOK";
  if (channel === "WHATSAPP" || channel === "WHATSAPP_GROUP") return "WHATSAPP";
  return "EMAIL";
}

// ── Signal detection ────────────────────────────────────────────────────────

interface Signal {
  taskType: string;
  priority: "HIGH" | "MEDIUM";
  evidenceType: string;
}

function detectSignal(text: string): Signal | null {
  const result = classifyMessage(text);

  switch (result.classification) {
    case "APPROVAL":
      return { taskType: "APPROVAL_RECEIVED", priority: "HIGH", evidenceType: "APPROVAL" };
    case "DISPUTE":
      return { taskType: "DISPUTE_FLAG", priority: "HIGH", evidenceType: "DISPUTE" };
    case "DELIVERY_UPDATE":
      return { taskType: "DELIVERY_UPDATE_RECEIVED", priority: "MEDIUM", evidenceType: "DELIVERY" };
    case "PO_DOCUMENT":
      return { taskType: "PO_RECEIVED_ON_THREAD", priority: "MEDIUM", evidenceType: "PO_RECEIVED" };
    default:
      return null;
  }
}

// ── Main appender ───────────────────────────────────────────────────────────

/**
 * Append a new message's effects to the linked ticket. Idempotent —
 * checks for existing Event with the same sourceRef before creating.
 */
export async function appendToLinkedTicket(ctx: AppendContext): Promise<AppendResult> {
  const result: AppendResult = {
    eventCreated: false,
    evidenceCreated: false,
    taskCreated: null,
  };

  // Guard: check manualMode on both thread and ticket
  const [thread, ticket] = await Promise.all([
    prisma.inboxThread.findUnique({
      where: { id: ctx.threadId },
      select: { manualMode: true },
    }),
    prisma.ticket.findUnique({
      where: { id: ctx.linkedTicketId },
      select: { manualMode: true, status: true },
    }),
  ]);

  if (!thread || !ticket) return result;
  if (thread.manualMode || ticket.manualMode) return result;

  // Don't append to closed/invoiced/locked tickets
  const closedStatuses = new Set(["CLOSED", "INVOICED", "LOCKED"]);
  if (closedStatuses.has(ticket.status)) return result;

  // Idempotency: check if we already created an event for this ingestion event
  const sourceRef = `ingestion:${ctx.ingestionEventId}`;
  const existing = await prisma.event.findFirst({
    where: { ticketId: ctx.linkedTicketId, sourceRef },
  });
  if (existing) return result;

  const snippet = (ctx.messageSnippet ?? "").slice(0, 500);
  const senderLabel = ctx.sender ?? "unknown";

  // 1. Create Event on the linked ticket
  try {
    await prisma.event.create({
      data: {
        ticketId: ctx.linkedTicketId,
        eventType: "COMMS_RECEIVED",
        timestamp: ctx.occurredAt,
        sourceRef,
        notes: `${senderLabel}: ${snippet}`.slice(0, 1000),
      },
    });
    result.eventCreated = true;
  } catch (err) {
    console.warn(`[thread-appender] Event create failed for ${ctx.ingestionEventId}:`, err instanceof Error ? err.message : err);
  }

  // 2. If message has attachments → create EvidenceFragment
  if (ctx.hasAttachments) {
    try {
      await prisma.evidenceFragment.create({
        data: {
          ticketId: ctx.linkedTicketId,
          sourceType: channelToSourceType(ctx.channel),
          fragmentType: "INSTRUCTION",
          fragmentText: `Attachment received from ${senderLabel}: ${snippet}`.slice(0, 1000),
          sourceRef,
          timestamp: ctx.occurredAt,
          isPrimaryEvidence: false,
        },
      });
      result.evidenceCreated = true;
    } catch (err) {
      console.warn(`[thread-appender] Evidence create failed for ${ctx.ingestionEventId}:`, err instanceof Error ? err.message : err);
    }
  }

  // 3. If message contains a status-changing signal → create Task
  if (snippet.length > 10) {
    const signal = detectSignal(snippet);
    if (signal) {
      try {
        // Don't duplicate: check for existing open task of same type on this ticket
        const existingTask = await prisma.task.findFirst({
          where: {
            ticketId: ctx.linkedTicketId,
            taskType: signal.taskType,
            status: "OPEN",
          },
        });

        if (!existingTask) {
          await prisma.task.create({
            data: {
              ticketId: ctx.linkedTicketId,
              taskType: signal.taskType,
              priority: signal.priority,
              status: "OPEN",
              generatedReason: `Signal detected in ${ctx.channel.toLowerCase()} from ${senderLabel}: ${snippet.slice(0, 200)}`,
            },
          });
          result.taskCreated = signal.taskType;
        }

        // Also create typed evidence for signals
        if (!ctx.hasAttachments) {
          // Only if we didn't already create evidence above
          await prisma.evidenceFragment.create({
            data: {
              ticketId: ctx.linkedTicketId,
              sourceType: channelToSourceType(ctx.channel),
              fragmentType: signal.evidenceType as any,
              fragmentText: `${senderLabel}: ${snippet}`.slice(0, 1000),
              sourceRef: `${sourceRef}:signal`,
              timestamp: ctx.occurredAt,
              isPrimaryEvidence: false,
            },
          });
        }
      } catch (err) {
        console.warn(`[thread-appender] Signal task create failed for ${ctx.ingestionEventId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return result;
}

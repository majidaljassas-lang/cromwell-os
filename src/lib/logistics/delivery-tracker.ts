/**
 * Delivery tracker — reacts to LogisticsEvent transitions and keeps the
 * rest of the system in sync.
 *
 * Public API:
 *   processLogisticsEvent(eventId)        — idempotent per-event processor
 *   runDeliveryTrackerSweep({ limit? })   — sweep for unprocessed events
 *   runAddressChangeDetection({ limit? }) — scans InboxThreadMessages for
 *                                           delivery addresses that differ
 *                                           from the ticket's site address
 *
 * Side effects on a failed delivery (BYPASSED / NOT_ARRIVED):
 *   • Task REDELIVERY_REQUIRED (URGENT, due tomorrow) on the ticket
 *   • Task ADDRESS_CONFLICT if the event's deliveryAddress differs from
 *     the ticket's site address
 *   • Ticket.deliveryFailed = true
 *   • Immediate threeWayMatchBill() on every bill linked to this ticket
 *
 * Side effects on a successful delivery (DELIVERED):
 *   • LogisticsEvent.deliveredAt set if null
 *   • Ticket.deliveryFailed cleared if the latest signal is DELIVERED
 *     (so a reattempted drop can re-open the ticket cleanly)
 *   • triggerInvoiceCheck(ticketId) — Phase 4 stub
 *   • Immediate threeWayMatchBill() on every bill linked to this ticket
 *
 * Task idempotency is keyed on (ticketId, taskType, status ∈ open). One
 * open task of each type per ticket at a time — avoids flooding the queue
 * when the tracker re-runs.
 *
 * Real-world caveat noted in Phase 2: many bills have no CostAllocation
 * → ProcurementOrder chain (ORPHAN_BILL). That's fine here — the bill
 * search below finds bills by any ticket linkage, and threeWayMatchBill
 * returns cleanly whether or not a PO chain exists.
 */

import { prisma } from "@/lib/prisma";
import type { LogisticsStopStatus } from "@/generated/prisma";
import { threeWayMatchBill } from "@/lib/finance/three-way-match";
import { checkInvoiceRequired } from "@/lib/finance/invoice-trigger";

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ProcessLogisticsEventResult {
  eventId: string;
  ticketId: string;
  effectiveStatus: LogisticsStopStatus;
  actions: string[];
  tasksCreated: { id: string; taskType: string }[];
  billsRematched: string[];
  addressConflict: boolean;
  alreadyProcessed: boolean;
}

export async function processLogisticsEvent(
  eventId: string,
  opts: { force?: boolean } = {}
): Promise<ProcessLogisticsEventResult> {
  const event = await prisma.logisticsEvent.findUnique({
    where: { id: eventId },
    include: {
      ticket: {
        select: {
          id: true,
          siteId: true,
          deliveryFailed: true,
          site: {
            select: {
              id: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              postcode: true,
            },
          },
        },
      },
    },
  });

  if (!event) throw new Error(`LogisticsEvent ${eventId} not found`);

  const result: ProcessLogisticsEventResult = {
    eventId: event.id,
    ticketId: event.ticketId,
    effectiveStatus: "UNKNOWN",
    actions: [],
    tasksCreated: [],
    billsRematched: [],
    addressConflict: false,
    alreadyProcessed: false,
  };

  if (event.processedAt && !opts.force) {
    result.alreadyProcessed = true;
    result.effectiveStatus = event.stopStatus ?? "UNKNOWN";
    return result;
  }

  const effective = resolveStopStatus(event.stopStatus, event.eventType);
  result.effectiveStatus = effective;

  if (effective === "BYPASSED" || effective === "NOT_ARRIVED") {
    await handleFailedDelivery({
      event: {
        id: event.id,
        ticketId: event.ticketId,
        effective,
        deliveryAddress: event.deliveryAddress,
        cpRef: event.cpRef,
        plannedDate: event.plannedDate,
        driver: event.driver,
        timestamp: event.timestamp,
      },
      ticket: event.ticket,
      result,
    });
  } else if (effective === "DELIVERED") {
    await handleSuccessfulDelivery({
      event: {
        id: event.id,
        ticketId: event.ticketId,
        deliveredAt: event.deliveredAt,
        timestamp: event.timestamp,
      },
      ticket: event.ticket,
      result,
    });
  } else {
    result.actions.push(`status ${effective} — no-op`);
  }

  await prisma.logisticsEvent.update({
    where: { id: event.id },
    data: { processedAt: new Date() },
  });

  return result;
}

export interface SweepResult {
  ok: boolean;
  scanned: number;
  processed: number;
  failed: number;
  outcomes: ProcessLogisticsEventResult[];
  errors: Array<{ eventId: string; error: string }>;
}

export async function runDeliveryTrackerSweep(
  opts: { limit?: number } = {}
): Promise<SweepResult> {
  const limit = Math.min(opts.limit ?? 100, 500);

  const candidates = await prisma.logisticsEvent.findMany({
    where: { processedAt: null },
    select: { id: true },
    orderBy: { timestamp: "asc" },
    take: limit,
  });

  const result: SweepResult = {
    ok: true,
    scanned: 0,
    processed: 0,
    failed: 0,
    outcomes: [],
    errors: [],
  };

  for (const { id } of candidates) {
    try {
      const outcome = await processLogisticsEvent(id);
      result.scanned += 1;
      if (!outcome.alreadyProcessed) result.processed += 1;
      result.outcomes.push(outcome);
    } catch (err) {
      result.failed += 1;
      result.ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ eventId: id, error: msg });
      console.error(`[delivery-tracker] event ${id} failed:`, err);
    }
  }

  return result;
}

export interface AddressDetectionResult {
  ok: boolean;
  messagesScanned: number;
  conflictsFound: number;
  tasksCreated: number;
  outcomes: Array<{
    messageId: string;
    ticketId: string;
    ticketPostcode: string | null;
    detectedPostcode: string;
    taskId?: string;
  }>;
  errors: Array<{ messageId: string; error: string }>;
}

export async function runAddressChangeDetection(
  opts: { limit?: number; sinceHours?: number } = {}
): Promise<AddressDetectionResult> {
  const limit = Math.min(opts.limit ?? 200, 1000);
  const sinceHours = opts.sinceHours ?? 72;
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const messages = await prisma.inboxThreadMessage.findMany({
    where: {
      occurredAt: { gte: since },
      snippet: { not: null },
      thread: {
        linkedTicketId: { not: null },
        linkedTicket: {
          status: { notIn: ["CLOSED", "INVOICED", "LOCKED"] },
        },
      },
    },
    select: {
      id: true,
      snippet: true,
      thread: {
        select: {
          linkedTicketId: true,
          linkedTicket: {
            select: {
              id: true,
              site: {
                select: {
                  postcode: true,
                  addressLine1: true,
                  city: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });

  const result: AddressDetectionResult = {
    ok: true,
    messagesScanned: 0,
    conflictsFound: 0,
    tasksCreated: 0,
    outcomes: [],
    errors: [],
  };

  for (const msg of messages) {
    try {
      result.messagesScanned += 1;

      const linked = msg.thread.linkedTicket;
      const ticketId = msg.thread.linkedTicketId;
      if (!linked || !ticketId) continue;

      const detected = extractPostcode(msg.snippet ?? "");
      if (!detected) continue;

      const sitePostcode = normalizePostcode(linked.site?.postcode ?? null);
      const detectedNorm = normalizePostcode(detected);
      if (!sitePostcode) continue; // no baseline to compare
      if (detectedNorm === sitePostcode) continue;

      result.conflictsFound += 1;

      const existing = await prisma.task.findFirst({
        where: {
          ticketId,
          taskType: "ADDRESS_CHANGE_PENDING",
          status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
        },
        select: { id: true },
      });

      let taskId = existing?.id;
      if (!existing) {
        const reason = `Inbox message mentions postcode ${detected} which differs from site (${linked.site?.postcode ?? "unset"}).`;
        const draft = buildAddressChangeBody({
          detectedPostcode: detected,
          sitePostcode: linked.site?.postcode ?? null,
          siteAddressLine1: linked.site?.addressLine1 ?? null,
          siteCity: linked.site?.city ?? null,
          snippet: msg.snippet ?? "",
        });
        const created = await prisma.task.create({
          data: {
            ticketId,
            taskType: "ADDRESS_CHANGE_PENDING",
            priority: "HIGH",
            status: "OPEN",
            dueAt: endOfToday(),
            generatedReason: reason,
            draftBody: draft,
          },
          select: { id: true },
        });
        taskId = created.id;
        result.tasksCreated += 1;
      }

      result.outcomes.push({
        messageId: msg.id,
        ticketId,
        ticketPostcode: linked.site?.postcode ?? null,
        detectedPostcode: detected,
        taskId,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      result.errors.push({ messageId: msg.id, error: errMsg });
      result.ok = false;
      console.error(`[address-detection] message ${msg.id} failed:`, err);
    }
  }

  return result;
}

// ─── handlers ────────────────────────────────────────────────────────────────

interface FailedDeliveryCtx {
  event: {
    id: string;
    ticketId: string;
    effective: "BYPASSED" | "NOT_ARRIVED";
    deliveryAddress: string | null;
    cpRef: string | null;
    plannedDate: Date | null;
    driver: string | null;
    timestamp: Date;
  };
  ticket: {
    id: string;
    siteId: string | null;
    deliveryFailed: boolean;
    site: {
      id: string;
      addressLine1: string | null;
      addressLine2: string | null;
      city: string | null;
      postcode: string | null;
    } | null;
  };
  result: ProcessLogisticsEventResult;
}

async function handleFailedDelivery(ctx: FailedDeliveryCtx): Promise<void> {
  const { event, ticket, result } = ctx;

  // 1. REDELIVERY_REQUIRED task
  const redelivery = await ensureOpenTask({
    ticketId: event.ticketId,
    taskType: "REDELIVERY_REQUIRED",
    priority: "URGENT",
    dueAt: tomorrow(),
    generatedReason:
      `${event.effective} at ${event.timestamp.toISOString().slice(0, 10)}` +
      (event.cpRef ? ` (ref ${event.cpRef})` : ""),
    draftBody: buildRedeliveryBody(event),
  });
  if (redelivery) {
    result.tasksCreated.push({ id: redelivery.id, taskType: "REDELIVERY_REQUIRED" });
    result.actions.push(
      redelivery.created
        ? "REDELIVERY_REQUIRED task created"
        : "REDELIVERY_REQUIRED task already open"
    );
  }

  // 2. Address conflict check
  if (event.deliveryAddress && ticket.site) {
    const sitePostcode = normalizePostcode(ticket.site.postcode);
    const eventPostcode = normalizePostcode(extractPostcode(event.deliveryAddress));
    const addressesDiffer =
      (eventPostcode !== null && sitePostcode !== null && eventPostcode !== sitePostcode) ||
      (eventPostcode === null && !textLooselyMatches(event.deliveryAddress, ticket.site));

    if (addressesDiffer) {
      const conflict = await ensureOpenTask({
        ticketId: event.ticketId,
        taskType: "ADDRESS_CONFLICT",
        priority: "URGENT",
        dueAt: endOfToday(),
        generatedReason: `Driver address differs from site. Event: "${event.deliveryAddress}" vs site: "${siteAddressOneLine(ticket.site)}".`,
        draftBody: buildAddressConflictBody(event, ticket.site),
      });
      if (conflict) {
        result.tasksCreated.push({ id: conflict.id, taskType: "ADDRESS_CONFLICT" });
        result.actions.push(
          conflict.created
            ? "ADDRESS_CONFLICT task created"
            : "ADDRESS_CONFLICT task already open"
        );
        result.addressConflict = true;
      }
    }
  }

  // 3. Mark ticket deliveryFailed
  if (!ticket.deliveryFailed) {
    await prisma.ticket.update({
      where: { id: event.ticketId },
      data: { deliveryFailed: true },
    });
    result.actions.push("ticket.deliveryFailed = true");
  }

  // 4. Re-run 3-way match for all bills on this ticket
  const rematched = await rematchBillsForTicket(event.ticketId);
  result.billsRematched = rematched;
  if (rematched.length) {
    result.actions.push(`3-way match re-run for ${rematched.length} bill(s)`);
  }
}

interface SuccessfulDeliveryCtx {
  event: {
    id: string;
    ticketId: string;
    deliveredAt: Date | null;
    timestamp: Date;
  };
  ticket: {
    id: string;
    deliveryFailed: boolean;
  };
  result: ProcessLogisticsEventResult;
}

async function handleSuccessfulDelivery(
  ctx: SuccessfulDeliveryCtx
): Promise<void> {
  const { event, ticket, result } = ctx;

  if (!event.deliveredAt) {
    await prisma.logisticsEvent.update({
      where: { id: event.id },
      data: { deliveredAt: event.timestamp },
    });
    result.actions.push(`deliveredAt set to ${event.timestamp.toISOString()}`);
  }

  if (ticket.deliveryFailed) {
    await prisma.ticket.update({
      where: { id: event.ticketId },
      data: { deliveryFailed: false },
    });
    result.actions.push("ticket.deliveryFailed cleared (later delivery confirmed)");
  }

  try {
    const invoiceCheck = await checkInvoiceRequired(event.id);
    result.actions.push(
      `invoice-check: ${invoiceCheck.message}` +
        (invoiceCheck.created ? ` (task ${invoiceCheck.taskId})` : "")
    );
  } catch (err) {
    console.error(
      `[delivery-tracker] invoice check failed for ticket ${event.ticketId}:`,
      err
    );
    result.actions.push(
      `invoice-check errored: ${err instanceof Error ? err.message : "unknown"}`
    );
  }

  const rematched = await rematchBillsForTicket(event.ticketId);
  result.billsRematched = rematched;
  if (rematched.length) {
    result.actions.push(`3-way match re-run for ${rematched.length} bill(s)`);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function resolveStopStatus(
  stopStatus: LogisticsStopStatus | null,
  eventType: string | null
): LogisticsStopStatus {
  if (stopStatus) return stopStatus;
  const t = (eventType || "").toUpperCase();
  if (!t) return "UNKNOWN";
  if (t.includes("BYPASS")) return "BYPASSED";
  if (
    t.includes("NOT_ARRIVED") ||
    t.includes("NOT ARRIVED") ||
    t === "FAILED" ||
    t.includes("FAILED_DELIVERY")
  ) {
    return "NOT_ARRIVED";
  }
  if (t.includes("DELIVER") && !t.includes("NOT") && !t.includes("FAIL")) {
    return "DELIVERED";
  }
  if (t.includes("DEPART") || t.includes("DISPATCH")) return "DEPARTED";
  return "UNKNOWN";
}

interface EnsureOpenTaskInput {
  ticketId: string;
  taskType: string;
  priority: string;
  dueAt: Date;
  generatedReason: string;
  draftBody: string;
  supplierBillId?: string;
}

async function ensureOpenTask(
  input: EnsureOpenTaskInput
): Promise<{ id: string; created: boolean } | null> {
  const existing = await prisma.task.findFirst({
    where: {
      ticketId: input.ticketId,
      taskType: input.taskType,
      status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
      ...(input.supplierBillId ? { supplierBillId: input.supplierBillId } : {}),
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await prisma.task.create({
    data: {
      ticketId: input.ticketId,
      taskType: input.taskType,
      priority: input.priority,
      status: "OPEN",
      dueAt: input.dueAt,
      generatedReason: input.generatedReason,
      draftBody: input.draftBody,
      ...(input.supplierBillId ? { supplierBillId: input.supplierBillId } : {}),
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function rematchBillsForTicket(ticketId: string): Promise<string[]> {
  const bills = await prisma.supplierBill.findMany({
    where: {
      lines: {
        some: {
          OR: [
            { ticketId },
            { costAllocations: { some: { ticketLine: { ticketId } } } },
          ],
        },
      },
    },
    select: { id: true },
  });

  const rematched: string[] = [];
  for (const bill of bills) {
    try {
      await threeWayMatchBill(bill.id);
      rematched.push(bill.id);
    } catch (err) {
      console.error(
        `[delivery-tracker] rematch failed for bill ${bill.id}:`,
        err
      );
    }
  }
  return rematched;
}

const UK_POSTCODE_RE = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s?([0-9][A-Z]{2})\b/i;

function extractPostcode(text: string): string | null {
  const m = text.match(UK_POSTCODE_RE);
  if (!m) return null;
  return `${m[1]} ${m[2]}`.toUpperCase();
}

function normalizePostcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(UK_POSTCODE_RE);
  if (!m) return null;
  return `${m[1]} ${m[2]}`.toUpperCase();
}

function textLooselyMatches(
  text: string,
  site: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postcode: string | null;
  }
): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const t = norm(text);
  if (!t) return false;
  for (const candidate of [
    site.addressLine1,
    site.addressLine2,
    site.city,
    site.postcode,
  ]) {
    const c = norm(candidate);
    if (c && t.includes(c)) return true;
  }
  return false;
}

function siteAddressOneLine(site: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postcode: string | null;
}): string {
  return [site.addressLine1, site.addressLine2, site.city, site.postcode]
    .filter(Boolean)
    .join(", ");
}

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(17, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

function buildRedeliveryBody(event: {
  effective: "BYPASSED" | "NOT_ARRIVED";
  deliveryAddress: string | null;
  cpRef: string | null;
  plannedDate: Date | null;
  driver: string | null;
  timestamp: Date;
}): string {
  return [
    `Redelivery required — ${event.effective.replace("_", " ").toLowerCase()}`,
    ``,
    `Planned date : ${event.plannedDate?.toISOString().slice(0, 10) ?? "—"}`,
    `Attempted at : ${event.timestamp.toISOString().slice(0, 10)}`,
    `CP ref       : ${event.cpRef ?? "—"}`,
    `Driver       : ${event.driver ?? "—"}`,
    `Address used : ${event.deliveryAddress ?? "—"}`,
    ``,
    `Action: rebook the drop. If the site address was wrong on the PO, resolve the ADDRESS_CONFLICT task before rebooking — do not auto-amend a live PO.`,
  ].join("\n");
}

function buildAddressConflictBody(
  event: { deliveryAddress: string | null; cpRef: string | null },
  site: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postcode: string | null;
  }
): string {
  return [
    `Address conflict detected on failed delivery${event.cpRef ? ` (CP ${event.cpRef})` : ""}.`,
    ``,
    `Driver address : ${event.deliveryAddress ?? "—"}`,
    `Site on ticket : ${siteAddressOneLine(site)}`,
    ``,
    `Holding all address changes on this ticket until resolved. Actions: CONFIRM site address OR REJECT / re-issue PO to correct address.`,
  ].join("\n");
}

function buildAddressChangeBody(args: {
  detectedPostcode: string;
  sitePostcode: string | null;
  siteAddressLine1: string | null;
  siteCity: string | null;
  snippet: string;
}): string {
  return [
    `Inbox message suggests a different delivery address:`,
    ``,
    `Proposed postcode : ${args.detectedPostcode}`,
    `Current site      : ${[args.siteAddressLine1, args.siteCity, args.sitePostcode].filter(Boolean).join(", ") || "—"}`,
    ``,
    `Message snippet:`,
    `"${args.snippet.slice(0, 400)}${args.snippet.length > 400 ? "…" : ""}"`,
    ``,
    `Action: CONFIRM if the site genuinely moves (re-issue PO to new address) OR REJECT if this is unrelated. Holding all live POs pending decision.`,
  ].join("\n");
}

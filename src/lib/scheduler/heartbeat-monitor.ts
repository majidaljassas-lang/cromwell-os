/**
 * Heartbeat monitor — observable, alertable intake.
 *
 * Two responsibilities:
 *   1. `getIntakeHealthSnapshot()` — pure read, used by both the API endpoint
 *      and the alert engine so they cannot drift.
 *   2. `runHeartbeatMonitor()` — idempotently writes Task rows when:
 *        - poller is dead (no SchedulerLog status=OK in last 30 min)
 *        - IntakeDocument backlog (NEW + ERROR) crosses thresholds
 *        - IntakeDocument 24h failure rate spikes (and there is real volume)
 *
 * Tasks require a non-null ticketId, so alerts attach to a single sentinel
 * "System Health" ticket (created once, reused forever). Idempotency: at most
 * one OPEN task per taskType at a time — existing rows get their priority and
 * generatedReason updated rather than duplicated.
 */

import { prisma } from "@/lib/prisma";

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot (shared with /api/admin/intake-health)
// ─────────────────────────────────────────────────────────────────────────────

export type PollerStatus = "HEALTHY" | "STALE" | "DEAD";

export interface IntakeHealthSnapshot {
  asOf: string;
  poller: {
    lastRunAt: string | null;
    ageSeconds: number | null;
    status: PollerStatus;
    lastJobError: string | null;
  };
  queue: {
    intakeDocuments: Record<string, number>;
    ingestionEvents: Record<string, number>;
    reviewQueueItems: Record<string, number>;
    oldestUnprocessed:
      | { intakeDocumentId: string; ageHours: number; status: string; errorMessage: string | null }
      | null;
  };
  throughput: {
    billsPostedLast24h: number;
    billsPostedLast7d: number;
    ingestionLast24h: number;
    intakeDocsLast24h: number;
    errorRate24h: number;
  };
  failures: {
    intakeDocumentTopErrors: Array<{ errorMessage: string; count: number }>;
    ingestionEventTopErrors: Array<{ errorMessage: string; count: number }>;
  };
}

const HEALTHY_MAX_SECONDS = 5 * 60;
const STALE_MAX_SECONDS = 30 * 60;

function classifyPoller(ageSeconds: number | null): PollerStatus {
  if (ageSeconds === null) return "DEAD";
  if (ageSeconds < HEALTHY_MAX_SECONDS) return "HEALTHY";
  if (ageSeconds < STALE_MAX_SECONDS) return "STALE";
  return "DEAD";
}

export async function getIntakeHealthSnapshot(): Promise<IntakeHealthSnapshot> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    lastOkLog,
    lastFailedLog,
    intakeStatusGroups,
    eventStatusGroups,
    reviewQueueGroups,
    oldestUnprocessed,
    billsPostedLast24h,
    billsPostedLast7d,
    ingestionLast24h,
    intakeDocsLast24h,
    intakeDocsErroredLast24h,
    intakeDocErrorGroups,
    ingestionEventErrorGroups,
    latestIngestionEvent,
  ] = await Promise.all([
    prisma.schedulerLog.findFirst({
      where: { status: "OK" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, finishedAt: true, job: true },
    }),
    prisma.schedulerLog.findFirst({
      where: { status: "FAILED" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, error: true, job: true },
    }),
    prisma.intakeDocument.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.ingestionEvent.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.reviewQueueItem.groupBy({
      by: ["queueType"],
      where: { status: "OPEN_REVIEW" },
      _count: { _all: true },
    }),
    prisma.intakeDocument.findFirst({
      where: { status: { in: ["NEW", "ERROR", "OCR_REQUIRED", "REVIEW_REQUIRED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, status: true, errorMessage: true },
    }),
    prisma.supplierBill.count({
      where: { status: "POSTED", createdAt: { gte: since24h } },
    }),
    prisma.supplierBill.count({
      where: { status: "POSTED", createdAt: { gte: since7d } },
    }),
    prisma.ingestionEvent.count({
      where: { createdAt: { gte: since24h } },
    }),
    prisma.intakeDocument.count({
      where: { createdAt: { gte: since24h } },
    }),
    prisma.intakeDocument.count({
      where: { createdAt: { gte: since24h }, status: { in: ["ERROR", "DEAD_LETTER"] } },
    }),
    prisma.intakeDocument.groupBy({
      by: ["errorMessage"],
      where: { errorMessage: { not: null }, status: { in: ["ERROR", "DEAD_LETTER"] } },
      _count: { _all: true },
      orderBy: { _count: { errorMessage: "desc" } },
      take: 5,
    }),
    prisma.ingestionEvent.groupBy({
      by: ["errorMessage"],
      where: { errorMessage: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { errorMessage: "desc" } },
      take: 5,
    }),
    prisma.ingestionEvent.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  // Poller liveness: SchedulerLog (when poller calls /api/scheduler endpoints)
  // OR fresh IngestionEvent rows (when poller calls outlook-sync, which doesn't
  // write SchedulerLog). The most recent of either signals "poller is alive".
  const schedulerRunAt = lastOkLog?.finishedAt ?? lastOkLog?.startedAt ?? null;
  const eventRunAt = latestIngestionEvent?.createdAt ?? null;
  const lastRunAt =
    schedulerRunAt && eventRunAt
      ? new Date(Math.max(schedulerRunAt.getTime(), eventRunAt.getTime()))
      : schedulerRunAt ?? eventRunAt;
  const ageSeconds = lastRunAt
    ? Math.max(0, Math.floor((now.getTime() - lastRunAt.getTime()) / 1000))
    : null;
  const pollerStatus = classifyPoller(ageSeconds);

  const lastJobError =
    lastFailedLog &&
    (!lastRunAt || lastFailedLog.startedAt.getTime() > lastRunAt.getTime())
      ? lastFailedLog.error ?? `${lastFailedLog.job} failed`
      : null;

  const intakeDocuments = Object.fromEntries(
    intakeStatusGroups.map((g) => [g.status, g._count._all])
  );
  const ingestionEvents = Object.fromEntries(
    eventStatusGroups.map((g) => [g.status, g._count._all])
  );
  const reviewQueueItems = Object.fromEntries(
    reviewQueueGroups.map((g) => [g.queueType, g._count._all])
  );

  const oldestUnprocessedOut = oldestUnprocessed
    ? {
        intakeDocumentId: oldestUnprocessed.id,
        ageHours: Math.floor(
          (now.getTime() - oldestUnprocessed.createdAt.getTime()) / (60 * 60 * 1000)
        ),
        status: oldestUnprocessed.status,
        errorMessage: oldestUnprocessed.errorMessage ?? null,
      }
    : null;

  const errorRate24h =
    intakeDocsLast24h >= 5 ? intakeDocsErroredLast24h / intakeDocsLast24h : 0;

  return {
    asOf: now.toISOString(),
    poller: {
      lastRunAt: lastRunAt?.toISOString() ?? null,
      ageSeconds,
      status: pollerStatus,
      lastJobError,
    },
    queue: {
      intakeDocuments,
      ingestionEvents,
      reviewQueueItems,
      oldestUnprocessed: oldestUnprocessedOut,
    },
    throughput: {
      billsPostedLast24h,
      billsPostedLast7d,
      ingestionLast24h,
      intakeDocsLast24h,
      errorRate24h: Math.round(errorRate24h * 1000) / 1000,
    },
    failures: {
      intakeDocumentTopErrors: intakeDocErrorGroups
        .filter((g) => g.errorMessage !== null)
        .map((g) => ({ errorMessage: g.errorMessage as string, count: g._count._all })),
      ingestionEventTopErrors: ingestionEventErrorGroups
        .filter((g) => g.errorMessage !== null)
        .map((g) => ({ errorMessage: g.errorMessage as string, count: g._count._all })),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert engine
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_CUSTOMER_NAME = "__SYSTEM_HEALTH__";
const SYSTEM_TICKET_TITLE = "System Health Alerts";
const OPEN_TASK_STATUSES_NOT_IN = ["DONE", "RESOLVED", "CLOSED", "REJECTED", "COMPLETED"];

/** Find or create the sentinel ticket that all system-level intake alerts attach to. */
async function getOrCreateSystemTicketId(): Promise<string> {
  const existingTicket = await prisma.ticket.findFirst({
    where: { title: SYSTEM_TICKET_TITLE, source: "SYSTEM_HEALTH" },
    select: { id: true },
  });
  if (existingTicket) return existingTicket.id;

  let customer = await prisma.customer.findFirst({
    where: { name: SYSTEM_CUSTOMER_NAME },
    select: { id: true },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: SYSTEM_CUSTOMER_NAME,
        notes: "Internal sentinel customer for system health alerts. Do not edit.",
        isBillingEntity: false,
      },
      select: { id: true },
    });
  }

  const ticket = await prisma.ticket.create({
    data: {
      title: SYSTEM_TICKET_TITLE,
      description: "Sentinel ticket for intake-health Tasks. Do not close.",
      payingCustomerId: customer.id,
      ticketMode: "PROJECT_WORK",
      status: "CAPTURED",
      source: "SYSTEM_HEALTH",
    },
    select: { id: true },
  });
  return ticket.id;
}

interface AlertSpec {
  taskType: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  reason: string;
}

async function upsertAlert(ticketId: string, spec: AlertSpec): Promise<"created" | "updated" | "noop"> {
  const existing = await prisma.task.findFirst({
    where: {
      ticketId,
      taskType: spec.taskType,
      status: { notIn: OPEN_TASK_STATUSES_NOT_IN },
    },
    select: { id: true, priority: true, generatedReason: true },
  });

  if (!existing) {
    await prisma.task.create({
      data: {
        ticketId,
        taskType: spec.taskType,
        priority: spec.priority,
        status: "OPEN",
        generatedReason: spec.reason,
      },
    });
    return "created";
  }

  if (existing.priority !== spec.priority || existing.generatedReason !== spec.reason) {
    await prisma.task.update({
      where: { id: existing.id },
      data: { priority: spec.priority, generatedReason: spec.reason },
    });
    return "updated";
  }
  return "noop";
}

async function clearAlert(ticketId: string, taskType: string): Promise<number> {
  const result = await prisma.task.updateMany({
    where: {
      ticketId,
      taskType,
      status: { notIn: OPEN_TASK_STATUSES_NOT_IN },
    },
    data: { status: "RESOLVED" },
  });
  return result.count;
}

export interface HeartbeatResult {
  ok: boolean;
  ranAt: string;
  alerts: {
    pollerDead: "created" | "updated" | "noop" | "cleared" | "skipped";
    queueBacklog: "created" | "updated" | "noop" | "cleared" | "skipped";
    failureSpike: "created" | "updated" | "noop" | "cleared" | "skipped";
  };
  snapshot: {
    pollerStatus: PollerStatus;
    pollerAgeSeconds: number | null;
    backlogCount: number;
    errorRate24h: number;
  };
}

export async function runHeartbeatMonitor(): Promise<HeartbeatResult> {
  const snap = await getIntakeHealthSnapshot();
  const ticketId = await getOrCreateSystemTicketId();

  const alerts: HeartbeatResult["alerts"] = {
    pollerDead: "skipped",
    queueBacklog: "skipped",
    failureSpike: "skipped",
  };

  // 1) Poller dead
  if (snap.poller.status === "DEAD") {
    const ageMin = snap.poller.ageSeconds === null ? "∞" : Math.round(snap.poller.ageSeconds / 60);
    const lastRun = snap.poller.lastRunAt ?? "never";
    const lastErr = snap.poller.lastJobError ?? "(none)";
    const reason = `No automation/poller activity in ${ageMin} minutes — last run: ${lastRun}, last error: ${lastErr}`;
    const r = await upsertAlert(ticketId, {
      taskType: "INTAKE_POLLER_DEAD",
      priority: "CRITICAL",
      reason,
    });
    alerts.pollerDead = r;
  } else {
    const cleared = await clearAlert(ticketId, "INTAKE_POLLER_DEAD");
    alerts.pollerDead = cleared > 0 ? "cleared" : "skipped";
  }

  // 2) Queue depth
  const newCount = snap.queue.intakeDocuments["NEW"] ?? 0;
  const errCount = snap.queue.intakeDocuments["ERROR"] ?? 0;
  const backlog = newCount + errCount;
  const oldestHrs = snap.queue.oldestUnprocessed?.ageHours ?? 0;

  if (backlog > 50) {
    const priority = backlog > 200 ? "CRITICAL" : "HIGH";
    const reason = `${backlog} IntakeDocuments stuck (NEW: ${newCount}, ERROR: ${errCount}). Oldest: ${oldestHrs}h.`;
    const r = await upsertAlert(ticketId, {
      taskType: "INTAKE_QUEUE_BACKLOG",
      priority,
      reason,
    });
    alerts.queueBacklog = r;
  } else {
    const cleared = await clearAlert(ticketId, "INTAKE_QUEUE_BACKLOG");
    alerts.queueBacklog = cleared > 0 ? "cleared" : "skipped";
  }

  // 3) Failure rate spike
  const rate = snap.throughput.errorRate24h;
  if (snap.throughput.intakeDocsLast24h >= 5 && rate > 0.5) {
    const pct = Math.round(rate * 100);
    const topErr = snap.failures.intakeDocumentTopErrors[0]?.errorMessage ?? "(unknown)";
    const reason = `${pct}% of last-24h IntakeDocuments failed. Top reason: ${topErr}`;
    const r = await upsertAlert(ticketId, {
      taskType: "INTAKE_FAILURE_SPIKE",
      priority: "HIGH",
      reason,
    });
    alerts.failureSpike = r;
  } else {
    const cleared = await clearAlert(ticketId, "INTAKE_FAILURE_SPIKE");
    alerts.failureSpike = cleared > 0 ? "cleared" : "skipped";
  }

  return {
    ok: true,
    ranAt: snap.asOf,
    alerts,
    snapshot: {
      pollerStatus: snap.poller.status,
      pollerAgeSeconds: snap.poller.ageSeconds,
      backlogCount: backlog,
      errorRate24h: rate,
    },
  };
}

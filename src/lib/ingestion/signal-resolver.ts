/**
 * Signal → Task resolver (Universal Ingestion, Phase A)
 *
 * When a reaction signal lands (e.g. a supplier ACK matching an open PO),
 * find every open Task that declared `closesOnSignal` matching this signal
 * and close it. Reactions auto-resolve. No human clicks "done" on a task
 * the system could have closed itself.
 *
 * A Task closes on signal when:
 *   1. closesOnSignal.docType === signal.docType
 *   2. every key/value in closesOnSignal.matcher is present (and equal) in signal.matcher
 *
 * Tasks are loud about how they closed: status → DONE, closedBySignal stores
 * the source identifier (typically an IntakeDocument id), audit log row written.
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export interface IngestionSignal {
  docType: string;
  matcher: Record<string, string | number | null | undefined>;
  /** Identifier of the artefact emitting the signal — usually an IntakeDocument id. */
  source: string;
}

export interface ResolveResult {
  closedTaskIds: string[];
  inspected: number;
}

function matcherSatisfies(
  taskMatcher: unknown,
  signalMatcher: IngestionSignal["matcher"],
): boolean {
  if (!taskMatcher || typeof taskMatcher !== "object") return false;
  for (const [key, expected] of Object.entries(taskMatcher as Record<string, unknown>)) {
    if (expected === null || expected === undefined) continue;
    if (signalMatcher[key] !== expected) return false;
  }
  return true;
}

export async function resolveTasksForSignal(signal: IngestionSignal): Promise<ResolveResult> {
  const candidates = await prisma.task.findMany({
    where: {
      status: "OPEN",
      closesOnSignal: { not: null as unknown as undefined },
    },
    select: { id: true, closesOnSignal: true, taskType: true, ticketId: true },
  });

  const matched = candidates.filter((t) => {
    const spec = t.closesOnSignal as { docType?: string; matcher?: Record<string, unknown> } | null;
    if (!spec || spec.docType !== signal.docType) return false;
    return matcherSatisfies(spec.matcher, signal.matcher);
  });

  if (matched.length === 0) {
    return { closedTaskIds: [], inspected: candidates.length };
  }

  const ids = matched.map((t) => t.id);
  await prisma.task.updateMany({
    where: { id: { in: ids } },
    data: { status: "DONE", closedBySignal: signal.source },
  });

  // Inbox-zero hook: any InboxThread whose reaction Task just closed should
  // also leave the active queue. The thread's terminal status was already
  // set when the reaction was created (TRIAGED for things like quotes that
  // need follow-through, LINKED for ticket-bound work, ARCHIVED for fire-
  // and-forget). Here we just bump anything still sitting at NEW/TRIAGED
  // because the underlying work is now done.
  await prisma.inboxThread.updateMany({
    where: {
      reactionTaskId: { in: ids },
      status: { in: ["NEW", "TRIAGED"] },
    },
    data: { status: "ARCHIVED", triagedAt: new Date() },
  });

  await Promise.all(
    matched.map((t) =>
      logAudit({
        objectType: "Task",
        objectId: t.id,
        actionType: "AUTO_CLOSED_BY_SIGNAL",
        previousValue: { status: "OPEN" },
        newValue: { status: "DONE", closedBySignal: signal.source, signalDocType: signal.docType },
        reason: `Auto-closed by ${signal.docType} signal from ${signal.source}`,
      }),
    ),
  );

  return { closedTaskIds: ids, inspected: candidates.length };
}

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/system/health
 *
 * Public read-only summary of automation state. Safe to poll; no secrets.
 * Returns per-job last-run timestamps, open-task counts by type, and the
 * top-level operational numbers used by the command-centre header.
 */
export async function GET() {
  try {
    const [logs, openTasks, disputedBills, uninvoicedCount, surplusCount, criticalCount] =
      await Promise.all([
        prisma.schedulerLog.findMany({
          orderBy: { startedAt: "desc" },
          take: 50,
          select: { job: true, status: true, startedAt: true, finishedAt: true, error: true },
        }),
        prisma.task.groupBy({
          by: ["taskType"],
          where: { status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] } },
          _count: { _all: true },
        }),
        prisma.supplierBill.count({ where: { matchStatus: "DISPUTE" } }),
        prisma.logisticsEvent.count({
          where: {
            OR: [{ stopStatus: "DELIVERED" }, { deliveredAt: { not: null } }],
            timestamp: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
            ticket: { lines: { some: { invoiceLines: { none: {} } } } },
          },
        }),
        prisma.stockExcessRecord.count({
          where: {
            status: { notIn: ["RESOLVED", "CLOSED", "TRANSFERRED"] },
            excessCost: { gt: 0 },
          },
        }),
        prisma.task.count({
          where: {
            priority: "CRITICAL",
            status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
          },
        }),
      ]);

    // Latest entry per job
    const lastSchedulerRuns: Record<string, { status: string; startedAt: Date; finishedAt: Date | null; error: string | null }> = {};
    for (const log of logs) {
      if (!lastSchedulerRuns[log.job]) {
        lastSchedulerRuns[log.job] = {
          status: log.status,
          startedAt: log.startedAt,
          finishedAt: log.finishedAt,
          error: log.error,
        };
      }
    }

    const mostRecent = logs[0] ?? null;
    const dailySweep = lastSchedulerRuns["daily-sweep"] ?? null;

    return Response.json({
      generatedAt: new Date().toISOString(),
      lastSchedulerRun: mostRecent
        ? {
            job: mostRecent.job,
            status: mostRecent.status,
            startedAt: mostRecent.startedAt,
            finishedAt: mostRecent.finishedAt,
          }
        : null,
      lastDailySweep: dailySweep,
      lastSchedulerRuns,
      openTasksByType: Object.fromEntries(
        openTasks.map((t) => [t.taskType, t._count._all])
      ),
      unresolvedDisputes: disputedBills,
      uninvoicedDeliveries: uninvoicedCount,
      criticalAlerts: criticalCount,
      surplusUnresolved: surplusCount,
    });
  } catch (err) {
    console.error("[system/health] failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "system health failed" },
      { status: 500 }
    );
  }
}

import { prisma } from "@/lib/prisma";

export type JobStatus = "RUNNING" | "OK" | "PARTIAL" | "FAILED";

export interface RunJobOutcome<T> {
  logId: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date;
  result?: T;
  error?: string;
}

function looksPartial(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (r.ok === false) return true;
  if (Array.isArray(r.steps)) {
    return (r.steps as Array<{ ok?: boolean }>).some((s) => s && s.ok === false);
  }
  return false;
}

export async function runJob<T>(
  jobName: string,
  work: () => Promise<T>
): Promise<RunJobOutcome<T>> {
  const log = await prisma.schedulerLog.create({
    data: { job: jobName, status: "RUNNING" },
  });
  const startedAt = log.startedAt;

  try {
    const result = await work();
    const status: JobStatus = looksPartial(result) ? "PARTIAL" : "OK";
    const finishedAt = new Date();

    await prisma.schedulerLog.update({
      where: { id: log.id },
      data: {
        status,
        finishedAt,
        summary: result === undefined ? undefined : (result as object),
      },
    });

    return { logId: log.id, status, startedAt, finishedAt, result };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date();

    console.error(`[scheduler] job "${jobName}" failed:`, err);

    await prisma.schedulerLog.update({
      where: { id: log.id },
      data: { status: "FAILED", finishedAt, error: errorMsg },
    });

    return { logId: log.id, status: "FAILED", startedAt, finishedAt, error: errorMsg };
  }
}

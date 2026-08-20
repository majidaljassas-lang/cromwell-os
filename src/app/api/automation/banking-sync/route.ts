// POST /api/automation/banking-sync
// Scheduler-triggered open-banking sync. Same engine as /api/banking/sync but
// secret-guarded and wrapped in runJob() for SchedulerLog visibility.

import { runJob } from "@/lib/scheduler/runner";
import { syncAllConnections } from "@/lib/truelayer/sync";
import { checkSchedulerSecret } from "@/lib/scheduler/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  const outcome = await runJob("banking-sync", () => syncAllConnections());

  const httpStatus =
    outcome.status === "FAILED" ? 500 : outcome.status === "PARTIAL" ? 207 : 200;

  return Response.json(
    {
      logId: outcome.logId,
      status: outcome.status,
      startedAt: outcome.startedAt,
      finishedAt: outcome.finishedAt,
      error: outcome.error,
      result: outcome.result,
    },
    { status: httpStatus },
  );
}

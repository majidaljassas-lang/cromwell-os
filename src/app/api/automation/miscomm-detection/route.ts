import { runJob } from "@/lib/scheduler/runner";
import { runMiscommDetection } from "@/lib/intelligence/miscomm-detector";
import { checkSchedulerSecret } from "@/lib/scheduler/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
  const sinceHours = Math.min(Number(url.searchParams.get("sinceHours") || 72), 720);

  const outcome = await runJob("miscomm-detection", () =>
    runMiscommDetection({ limit, sinceHours })
  );

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
    { status: httpStatus }
  );
}

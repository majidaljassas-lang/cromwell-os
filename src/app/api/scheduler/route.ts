import { runJob } from "@/lib/scheduler/runner";
import { checkSchedulerSecret, schedulerSecretHeaders } from "@/lib/scheduler/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INTERNAL_BASE =
  process.env.SCHEDULER_INTERNAL_BASE ||
  process.env.INTERNAL_API_BASE ||
  "http://localhost:3000";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  const outcome = await runJob("run-all", async () => {
    const res = await fetch(`${INTERNAL_BASE}/api/automation/run-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...schedulerSecretHeaders() },
      cache: "no-store",
    });

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return {
      ok: res.ok && !(typeof body === "object" && body !== null && (body as { ok?: boolean }).ok === false),
      httpStatus: res.status,
      ...(typeof body === "object" && body !== null ? body : { body }),
    };
  });

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

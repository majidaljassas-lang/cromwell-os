import { runJob } from "@/lib/scheduler/runner";
import { runThreadLinker } from "@/lib/inbox/thread-linker";
import { checkSchedulerSecret } from "@/lib/scheduler/secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  let limit = Number(url.searchParams.get("limit") || 0);
  if (!limit) {
    try {
      const body = await request.json();
      if (body && typeof body.limit === "number") limit = body.limit;
    } catch {
      /* no body */
    }
  }
  if (!limit || !Number.isFinite(limit)) limit = 200;

  const outcome = await runJob("thread-linker", () =>
    runThreadLinker({ limit })
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

/**
 * Trickle-down orchestrator.
 *
 * Runs the full chain of autonomous back-office automation in order:
 *   1. Auto-progress tickets (state machine).
 *   2. Build evidence from events and linked ingestion messages.
 *   3. Generate / close tasks based on ticket state.
 *   4. Match unallocated supplier bill lines to ticket lines.
 *
 * This is the single endpoint the email poller hits every 10 minutes
 * so we only have one entry point to keep in sync.
 */

const BASE =
  process.env.TRICKLE_DOWN_BASE ||
  process.env.INTERNAL_API_BASE ||
  "http://localhost:3000";

type StepKey =
  | "backfillAttachments"
  | "ackMatcher"
  | "monitorThreads"
  | "aiShadow"
  | "autoProgress"
  | "buildEvidence"
  | "generateTasks"
  | "matchBills";

interface StepResult {
  step: StepKey;
  endpoint: string;
  ok: boolean;
  status: number;
  durationMs: number;
  result?: unknown;
  error?: string;
}

async function runStep(
  step: StepKey,
  endpoint: string
): Promise<StepResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    const durationMs = Date.now() - started;

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return {
      step,
      endpoint,
      ok: res.ok,
      status: res.status,
      durationMs,
      result: body,
      error: res.ok
        ? undefined
        : typeof body === "object" &&
            body !== null &&
            "error" in body &&
            typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      step,
      endpoint,
      ok: false,
      status: 0,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function POST() {
  const started = Date.now();

  // Run each step sequentially so later steps see the effects of earlier ones.
  // backfillAttachments runs first so any new PDF text is in ParsedMessage
  // before the monitor scans threads for items.
  const backfillAttachments = await runStep(
    "backfillAttachments",
    "/api/automation/sync/outlook/backfill-attachments?limit=10"
  );
  // ackMatcher runs after backfill (so PDFs are parsed) and before
  // monitorThreads. It takes unactioned supplier docs, anchors them to
  // tickets and creates ProcurementOrders deterministically.
  const ackMatcher = await runStep(
    "ackMatcher",
    "/api/automation/ack-matcher"
  );
  // monitorThreads runs next so any newly-extracted lines feed into the rest
  // of the chain (auto-progress, evidence, tasks).
  const monitorThreads = await runStep(
    "monitorThreads",
    "/api/automation/monitor-threads"
  );
  // aiShadow reads newly-ingested events and logs Claude's reasoning as
  // audit Event rows. Gracefully inert when ANTHROPIC_API_KEY is missing.
  const aiShadow = await runStep(
    "aiShadow",
    "/api/automation/ai-shadow"
  );
  const autoProgress = await runStep(
    "autoProgress",
    "/api/automation/auto-progress"
  );
  const buildEvidence = await runStep(
    "buildEvidence",
    "/api/automation/build-evidence"
  );
  const generateTasks = await runStep(
    "generateTasks",
    "/api/automation/generate-tasks"
  );
  const matchBills = await runStep(
    "matchBills",
    "/api/automation/match-bills"
  );

  const steps = [backfillAttachments, ackMatcher, monitorThreads, aiShadow, autoProgress, buildEvidence, generateTasks, matchBills];
  const allOk = steps.every((s) => s.ok);

  return Response.json(
    {
      ok: allOk,
      durationMs: Date.now() - started,
      runAt: new Date().toISOString(),
      steps,
      summary: {
        backfillAttachments: backfillAttachments.result,
        ackMatcher: ackMatcher.result,
        monitorThreads: monitorThreads.result,
        aiShadow: aiShadow.result,
        autoProgress: autoProgress.result,
        buildEvidence: buildEvidence.result,
        generateTasks: generateTasks.result,
        matchBills: matchBills.result,
      },
    },
    { status: allOk ? 200 : 207 }
  );
}

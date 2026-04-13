/**
 * General automation orchestrator.
 *
 * Runs ALL automation steps in sequence:
 *   1. Sync Outlook (pull new emails)
 *   2. Backfill attachments (ensure PDFs are downloaded + parsed)
 *   3. Classify unclassified events
 *   4. Process classified events (auto-action — including BILL_DOCUMENT)
 *   5. Process any remaining bill documents (standalone bill pipeline)
 *   6. Trickle-down (ack-matcher, monitor-threads, auto-progress, etc.)
 *
 * This is the single endpoint a cron job calls to run everything.
 * Each step is independent — one failure doesn't stop the others.
 */

const BASE =
  process.env.RUN_ALL_BASE ||
  process.env.INTERNAL_API_BASE ||
  "http://localhost:3000";

type StepKey =
  | "outlookSync"
  | "backfillAttachments"
  | "classify"
  | "autoAction"
  | "processBills"
  | "trickleDown";

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
  endpoint: string,
  method: "POST" | "GET" = "POST"
): Promise<StepResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}${endpoint}`, {
      method,
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

  // Step 1: Sync new emails from Outlook
  const outlookSync = await runStep(
    "outlookSync",
    "/api/automation/sync/outlook"
  );

  // Step 2: Backfill attachments (download + parse PDFs for any events missing them)
  const backfillAttachments = await runStep(
    "backfillAttachments",
    "/api/automation/sync/outlook/backfill-attachments?limit=25"
  );

  // Step 3: Classify any PARSED events that haven't been classified yet
  const classify = await runStep(
    "classify",
    "/api/automation/classify"
  );

  // Step 4: Auto-action on classified events (PO, ORDER, BILL_DOCUMENT, etc.)
  const autoAction = await runStep(
    "autoAction",
    "/api/automation/process"
  );

  // Step 5: Standalone bill processor (catches any BILL_DOCUMENT events
  // that auto-action might have missed or that were reclassified)
  const processBills = await runStep(
    "processBills",
    "/api/automation/process-bills"
  );

  // Step 6: Full trickle-down (ack-matcher, monitor-threads, auto-progress,
  // evidence, tasks, match-bills)
  const trickleDown = await runStep(
    "trickleDown",
    "/api/automation/trickle-down"
  );

  const steps = [
    outlookSync,
    backfillAttachments,
    classify,
    autoAction,
    processBills,
    trickleDown,
  ];
  const allOk = steps.every((s) => s.ok);

  return Response.json(
    {
      ok: allOk,
      durationMs: Date.now() - started,
      runAt: new Date().toISOString(),
      steps,
      summary: {
        outlookSync: outlookSync.ok ? "synced" : outlookSync.error,
        backfillAttachments: backfillAttachments.ok ? "done" : backfillAttachments.error,
        classify: classify.result,
        autoAction: autoAction.result,
        processBills: processBills.result,
        trickleDown: trickleDown.ok ? "done" : trickleDown.error,
      },
    },
    { status: allOk ? 200 : 207 }
  );
}

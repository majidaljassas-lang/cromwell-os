/**
 * General automation orchestrator — Phase 11 final ordering.
 *
 *   1.  outlookSync              — pull new emails
 *   2.  backfillAttachments      — ensure PDFs are downloaded + parsed
 *   3.  bankDetailCheck          — fraud check FIRST (safety)
 *   4.  threeWayMatch            — PO ↔ delivery ↔ bill reconciliation
 *   5.  deliveryTracker          — LogisticsEvent sweep
 *   6.  addressChangeDetection   — inbox postcode conflicts
 *   7.  miscommDetection         — cross-contact instruction conflicts
 *   8.  uninvoicedDeliveries     — client invoice trigger
 *   9.  surplusMatcher           — stock cross-ticket transfer opportunities
 *  10.  classify                 — classify PARSED events
 *  11.  threadLinker             — re-score InboxThreads (null/LOW) against open tickets
 *  12.  autoAction               — action classified events
 *  13.  processBills             — standalone bill pipeline
 *  14.  trickleDown              — ack-matcher, monitor-threads, auto-progress, etc.
 *
 * All 14 fan-out endpoints are secret-guarded; the orchestrator forwards
 * `x-scheduler-secret` via `schedulerSecretHeaders()`. Each step is
 * independent — one failure does NOT stop the others.
 */

import { checkSchedulerSecret, schedulerSecretHeaders } from "@/lib/scheduler/secret";

const BASE =
  process.env.RUN_ALL_BASE ||
  process.env.INTERNAL_API_BASE ||
  "http://localhost:3000";

type StepKey =
  | "outlookSync"
  | "backfillAttachments"
  | "bankDetailCheck"
  | "threeWayMatch"
  | "deliveryTracker"
  | "addressChangeDetection"
  | "miscommDetection"
  | "uninvoicedDeliveries"
  | "surplusMatcher"
  | "classify"
  | "threadLinker"
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
      headers: {
        "Content-Type": "application/json",
        ...schedulerSecretHeaders(),
      },
      cache: "no-store",
    });
    const durationMs = Date.now() - started;

    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }

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

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  const started = Date.now();

  const outlookSync            = await runStep("outlookSync",            "/api/automation/sync/outlook");
  const backfillAttachments    = await runStep("backfillAttachments",    "/api/automation/sync/outlook/backfill-attachments?limit=25");
  const bankDetailCheck        = await runStep("bankDetailCheck",        "/api/automation/bank-detail-check");
  const threeWayMatch          = await runStep("threeWayMatch",          "/api/automation/three-way-match");
  const deliveryTracker        = await runStep("deliveryTracker",        "/api/automation/delivery-tracker");
  const addressChangeDetection = await runStep("addressChangeDetection", "/api/automation/address-change-detection");
  const miscommDetection       = await runStep("miscommDetection",       "/api/automation/miscomm-detection");
  const uninvoicedDeliveries   = await runStep("uninvoicedDeliveries",   "/api/automation/uninvoiced-deliveries");
  const surplusMatcher         = await runStep("surplusMatcher",         "/api/automation/surplus-matcher");
  const classify               = await runStep("classify",               "/api/automation/classify");
  const threadLinker           = await runStep("threadLinker",           "/api/automation/thread-linker");
  const autoAction             = await runStep("autoAction",             "/api/automation/process");
  const processBills           = await runStep("processBills",           "/api/automation/process-bills");
  const trickleDown            = await runStep("trickleDown",            "/api/automation/trickle-down");

  const steps = [
    outlookSync, backfillAttachments,
    bankDetailCheck, threeWayMatch,
    deliveryTracker, addressChangeDetection, miscommDetection,
    uninvoicedDeliveries, surplusMatcher,
    classify, threadLinker, autoAction, processBills, trickleDown,
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
        bankDetailCheck: bankDetailCheck.ok ? bankDetailCheck.result : bankDetailCheck.error,
        threeWayMatch: threeWayMatch.ok ? threeWayMatch.result : threeWayMatch.error,
        deliveryTracker: deliveryTracker.ok ? deliveryTracker.result : deliveryTracker.error,
        addressChangeDetection: addressChangeDetection.ok ? addressChangeDetection.result : addressChangeDetection.error,
        miscommDetection: miscommDetection.ok ? miscommDetection.result : miscommDetection.error,
        uninvoicedDeliveries: uninvoicedDeliveries.ok ? uninvoicedDeliveries.result : uninvoicedDeliveries.error,
        surplusMatcher: surplusMatcher.ok ? surplusMatcher.result : surplusMatcher.error,
        classify: classify.result,
        threadLinker: threadLinker.ok ? threadLinker.result : threadLinker.error,
        autoAction: autoAction.result,
        processBills: processBills.result,
        trickleDown: trickleDown.ok ? "done" : trickleDown.error,
      },
    },
    { status: allOk ? 200 : 207 }
  );
}

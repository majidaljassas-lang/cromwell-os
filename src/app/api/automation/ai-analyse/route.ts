/**
 * POST /api/automation/ai-analyse
 *
 * Phase 12 step 11 — runs AI classifier on unanalysed InboxThreads.
 * Limit 20 per run (cost control). Secret-guarded.
 */

import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { runAiAnalyse } from "@/lib/intelligence/ai-classifier";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runAiAnalyse({ limit: 20 });
    return Response.json(result);
  } catch (error) {
    console.error("[ai-analyse] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "AI analysis failed" },
      { status: 500 },
    );
  }
}

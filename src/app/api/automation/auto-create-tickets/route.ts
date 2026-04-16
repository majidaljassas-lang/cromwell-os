/**
 * POST /api/automation/auto-create-tickets
 *
 * Phase 12 step 13 — creates tickets from high-confidence AI-analysed
 * InboxThreads. Limit 50 per run. Secret-guarded.
 */

import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { runAutoCreateTickets } from "@/lib/inbox/auto-ticket-creator";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const result = await runAutoCreateTickets({ limit: 50 });
    return Response.json(result);
  } catch (error) {
    console.error("[auto-create-tickets] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Auto-create tickets failed" },
      { status: 500 },
    );
  }
}

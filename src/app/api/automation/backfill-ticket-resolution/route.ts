/**
 * POST /api/automation/backfill-ticket-resolution
 *
 * Re-resolve customer + site on tickets created from inbox threads where
 * those fields are still placeholders or blanks. Secret-guarded.
 */

import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { runBackfillTicketResolution } from "@/lib/inbox/backfill-ticket-resolution";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const result = await runBackfillTicketResolution({ limit: isNaN(limit) ? 50 : limit });
    return Response.json(result);
  } catch (error) {
    console.error("[backfill-ticket-resolution] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Backfill failed" },
      { status: 500 },
    );
  }
}

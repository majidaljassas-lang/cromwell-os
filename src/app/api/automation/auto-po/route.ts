/**
 * POST /api/automation/auto-po
 *
 * Detects outbound confirmation messages on supplier-linked threads and
 * auto-creates ProcurementOrders. Secret-guarded.
 */

import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { runAutoPoFromConfirmation } from "@/lib/procurement/auto-po-from-confirmation";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const result = await runAutoPoFromConfirmation({ limit: isNaN(limit) ? 50 : limit });
    return Response.json(result);
  } catch (error) {
    console.error("[auto-po] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Auto-PO failed" },
      { status: 500 },
    );
  }
}

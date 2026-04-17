/**
 * POST /api/automation/supplier-quote-linker
 *
 * Phase 13 — extract supplier prices from inbound messages on
 * ticket-linked threads and create TicketLinePrice rows. Secret-guarded.
 */

import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { runSupplierQuoteLinker } from "@/lib/inbox/supplier-quote-linker";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const result = await runSupplierQuoteLinker({ limit: isNaN(limit) ? 50 : limit });
    return Response.json(result);
  } catch (error) {
    console.error("[supplier-quote-linker] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Supplier quote linker failed" },
      { status: 500 },
    );
  }
}

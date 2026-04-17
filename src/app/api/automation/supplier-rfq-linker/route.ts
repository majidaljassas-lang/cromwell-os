/**
 * POST /api/automation/supplier-rfq-linker
 *
 * Phase 13a — links unlinked supplier-sender InboxThreads to open
 * tickets whose lines mention the same products. Secret-guarded.
 */

import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { runSupplierRfqLinker } from "@/lib/inbox/supplier-rfq-linker";

export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const result = await runSupplierRfqLinker({ limit: isNaN(limit) ? 50 : limit });
    return Response.json(result);
  } catch (error) {
    console.error("[supplier-rfq-linker] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Supplier RFQ linker failed" },
      { status: 500 },
    );
  }
}

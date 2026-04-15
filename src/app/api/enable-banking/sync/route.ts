/**
 * POST /api/enable-banking/sync
 *
 * Syncs all active ENABLE_BANKING sources:
 *   - Upserts BankAccount rows
 *   - Pulls transactions since lastSyncAt (or 30 days on first run)
 *   - Upserts BankTransaction rows (idempotent on fitId = Enable transaction_id)
 *   - Raises auto-reconciliation suggestions (SUGGESTIONS ONLY — never auto-posts)
 *   - Sets connectorStatus = "REAUTH_REQUIRED" if the session has expired
 *
 * Called by the email-poller every 2 minutes. Safe to call at any frequency —
 * idempotent end-to-end.
 */

import { syncEnableBanking } from "@/lib/enable-banking/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await syncEnableBanking();
    return Response.json(result);
  } catch (e) {
    console.error("[enable-banking/sync]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 }
    );
  }
}

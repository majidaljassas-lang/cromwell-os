/**
 * Email poller worker (scaffold).
 *
 * TODO: wire into the existing scripts/email-poller.js + Outlook auth.
 *   - Pull messages from info@cromwellfreight.com via Microsoft Graph
 *   - For each attachment that looks like a bill (PDF/image), save to ./uploads/bills/
 *   - enqueueDocument({ sourceType: "EMAIL", sourceRef: messageId, fileRef })
 *   - For EML text bodies with inline bill lines, rawText is the body itself
 *
 * For now this is a stub so the worker registry is complete — the real integration
 * happens once the Outlook token/refresh plumbing is stable. The rest of the
 * pipeline is source-agnostic, so email support is a drop-in later.
 */

import { logAudit } from "@/lib/ingestion/audit";

export async function runEmailPoller(): Promise<{ picked: number; enqueued: number; note: string }> {
  await logAudit({
    objectType: "IntakeDocument",
    objectId:   "email-poller",
    actionType: "POLL_SKIPPED",
    actor:      "SYSTEM",
    reason:     "Email poller stub — integration TODO (Outlook → Graph → enqueueDocument)",
  });
  return {
    picked:   0,
    enqueued: 0,
    note:     "Email poller is a stub. Run scripts/email-poller.js for legacy behaviour until Graph integration lands.",
  };
}

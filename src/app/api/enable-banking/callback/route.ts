/**
 * GET /api/enable-banking/callback
 *
 * Enable Banking redirects the user here after they complete SCA at Barclays.
 * Query params: ?code=<auth_code>&state=<session_id>
 *
 * Flow:
 *   1. Extract session_id from the `state` param (we passed it in the
 *      redirect_url as ?state=<sessionId> in start-auth — Enable preserves it)
 *   2. PATCH /sessions/{sessionId} with the code to activate the session
 *   3. Mark the IngestionSource as active, status OK
 *   4. Redirect back to /finance
 *
 * Note: Enable Banking returns the session_id in the `state` query parameter
 * because we embed it in the redirect_url path when building the auth link.
 * If Enable puts it elsewhere, check the raw query params and adjust below.
 */

import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/enable-banking/client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    console.error("[enable-banking/callback] missing code or state", Object.fromEntries(searchParams));
    redirect("/finance?enable_error=missing_params");
  }

  try {
    // Step 2: exchange the code for a real session_id + accounts list
    const session = await createSession(code);

    // Find the pending row we created in start-auth (keyed by state)
    const pending = await prisma.ingestionSource.findFirst({
      where: { sourceType: "ENABLE_BANKING", externalRef: `pending:${state}` },
    });

    if (!pending) {
      console.error("[enable-banking/callback] No pending IngestionSource found for state", state);
      redirect("/finance?enable_error=session_not_found");
    }

    // Upgrade to a real session row
    await prisma.ingestionSource.update({
      where: { id: pending.id },
      data: {
        externalRef: session.session_id,
        isActive: true,
        connectorStatus: "OK",
        status: "ACTIVE",
        displayName: `Enable Banking — ${pending.accountName ?? "bank"}`,
        lastSyncAt: null, // first sync pulls default window
      },
    });

    redirect("/finance?enable_connected=1");
  } catch (e) {
    console.error("[enable-banking/callback] activation failed:", e);
    redirect(`/finance?enable_error=${encodeURIComponent(e instanceof Error ? e.message : "activation_failed")}`);
  }
}

/**
 * POST /api/enable-banking/start-auth
 *
 * Creates an Enable Banking consent session for a given ASPSP (bank).
 * Returns { authUrl, sessionId } — the caller should redirect the user
 * to authUrl to complete SCA at their bank.
 *
 * Body: { aspspName: string, aspspCountry?: string }
 *   aspspName examples: "Barclays Business", "Barclaycard"
 *   aspspCountry: ISO 3166-1 alpha-2, defaults to "GB"
 *
 * The sessionId is persisted immediately on a (PENDING) IngestionSource row so
 * we can look it up when the OAuth callback arrives.
 */

import { prisma } from "@/lib/prisma";
import { startAuthorization } from "@/lib/enable-banking/client";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { aspspName?: string; aspspCountry?: string };
    const aspspName = body.aspspName ?? "Barclays Business";
    const aspspCountry = body.aspspCountry ?? "GB";

    const appUrl =
      process.env.NEXTAUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000";
    const callbackUrl = `${appUrl}/api/enable-banking/callback`;

    // Step 1: start authorization. We use a random state so we can round-trip
    // through the bank and locate the pre-auth row when Enable redirects back.
    const state = crypto.randomUUID();
    const auth = await startAuthorization(callbackUrl, aspspCountry, aspspName, state);

    // Persist a PENDING row keyed by state. externalRef is upgraded to the real
    // session_id on callback; for now we store the authorization_id + state so
    // we can find the row again.
    await prisma.ingestionSource.create({
      data: {
        sourceType: "ENABLE_BANKING",
        externalRef: `pending:${state}`,
        accountName: aspspName,
        displayName: `Enable Banking — ${aspspName} (pending)`,
        connectorStatus: "PENDING_AUTH",
        isActive: false,
        isHistoricalCapable: true,
        // authorization_id isn't a first-class column; stash in status field for audit
        status: auth.authorization_id,
      },
    });

    return Response.json({ authUrl: auth.url, authorizationId: auth.authorization_id, state });
  } catch (e) {
    console.error("[enable-banking/start-auth]", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to start auth" },
      { status: 500 }
    );
  }
}

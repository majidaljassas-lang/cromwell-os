// POST /api/banking/plaid/link-token
// Body: {} (no input — single-tenant install, userId is fixed)
// Returns: { linkToken: string }
//
// The browser passes this token to Plaid Link. On success Link returns a
// public_token to /exchange.

import { NextResponse } from "next/server";
import { createLinkToken, isConfigured } from "@/lib/plaid/client";

const PLAID_USER_ID = "cromwell-os";

export async function POST() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET_SANDBOX." },
      { status: 400 },
    );
  }

  const webhookUrl = process.env.PLAID_WEBHOOK_URL || undefined;

  try {
    const linkToken = await createLinkToken({
      userId: PLAID_USER_ID,
      webhookUrl,
    });
    return NextResponse.json({ linkToken });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "link_token_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/banking/plaid/reauth
// Body: { connectionId: string }
// Returns: { linkToken: string }
//
// Mints an update-mode link_token for an existing item. The browser opens
// Plaid Link with this token and walks the user through re-consent.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createUpdateLinkToken, isConfigured } from "@/lib/plaid/client";

const PLAID_USER_ID = "cromwell-os";

export async function POST(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Plaid not configured" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const connectionId = (body.connectionId as string | undefined)?.trim();
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  }

  const conn = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || conn.provider !== "PLAID" || !conn.accessToken) {
    return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
  }

  try {
    const linkToken = await createUpdateLinkToken({
      userId: PLAID_USER_ID,
      accessToken: conn.accessToken,
      webhookUrl: process.env.PLAID_WEBHOOK_URL || undefined,
    });
    return NextResponse.json({ linkToken });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "reauth_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

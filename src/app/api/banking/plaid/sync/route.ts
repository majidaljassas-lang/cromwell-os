// POST /api/banking/plaid/sync
// User-triggered manual sync across all Plaid connections.
// Body: {} or { connectionId: string } to scope to one.

import { NextRequest, NextResponse } from "next/server";
import { syncAllPlaidConnections, syncOnePlaidConnection } from "@/lib/plaid/sync";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const connectionId = (body.connectionId as string | undefined)?.trim();

  if (connectionId) {
    try {
      const result = await syncOnePlaidConnection(connectionId);
      if (!result) {
        return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
      }
      return NextResponse.json(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "sync_failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const summary = await syncAllPlaidConnections();
  return NextResponse.json(summary);
}

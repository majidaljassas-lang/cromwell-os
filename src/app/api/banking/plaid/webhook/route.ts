// POST /api/banking/plaid/webhook
// Plaid posts here on transaction updates, login expiry, etc.
//
// Webhook codes we care about:
//   TRANSACTIONS / SYNC_UPDATES_AVAILABLE -> sync the item
//   ITEM / ERROR (with ITEM_LOGIN_REQUIRED) -> mark connection EXPIRED
//   ITEM / PENDING_EXPIRATION -> consent expiring within 7 days
//   ITEM / USER_PERMISSION_REVOKED -> mark connection REVOKED
//
// In sandbox/dev without a public URL this route is never hit; manual /sync
// is the verifiable path.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncOnePlaidConnection } from "@/lib/plaid/sync";

interface PlaidWebhookBody {
  webhook_type?: string;
  webhook_code?: string;
  item_id?: string;
  error?: { error_code?: string };
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PlaidWebhookBody;
  const itemId = body.item_id;
  const type = body.webhook_type;
  const code = body.webhook_code;

  if (!itemId) {
    return NextResponse.json({ ignored: "no_item_id" });
  }

  const conn = await prisma.bankConnection.findFirst({
    where: { provider: "PLAID", providerConnectionId: itemId },
  });
  if (!conn) {
    return NextResponse.json({ ignored: "unknown_item" });
  }

  if (type === "TRANSACTIONS" && code === "SYNC_UPDATES_AVAILABLE") {
    try {
      await syncOnePlaidConnection(conn.id);
      return NextResponse.json({ ok: true, action: "synced" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "sync_failed";
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  if (type === "ITEM" && code === "ERROR" && body.error?.error_code === "ITEM_LOGIN_REQUIRED") {
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: { status: "EXPIRED", lastSyncError: "ITEM_LOGIN_REQUIRED" },
    });
    return NextResponse.json({ ok: true, action: "marked_expired" });
  }

  if (type === "ITEM" && code === "PENDING_EXPIRATION") {
    // Plaid is warning consent expires in <7 days. Surface via the existing
    // consentExpiresAt countdown in the UI; no status change.
    return NextResponse.json({ ok: true, action: "pending_logged" });
  }

  if (type === "ITEM" && code === "USER_PERMISSION_REVOKED") {
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: { status: "REVOKED", lastSyncError: "USER_PERMISSION_REVOKED" },
    });
    return NextResponse.json({ ok: true, action: "marked_revoked" });
  }

  return NextResponse.json({ ok: true, action: "ignored", type, code });
}

// POST /api/banking/plaid/exchange
// Body: { publicToken: string }
// Returns: { connectionId: string }
//
// Called by Plaid Link onSuccess. Exchanges public_token → access_token,
// creates the BankConnection, fetches accounts, creates BankAccount rows.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exchangePublicToken,
  getItemInstitution,
  getAccounts,
  isConfigured,
} from "@/lib/plaid/client";
import { upsertAccountFromPlaid } from "@/lib/plaid/upsert";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Plaid not configured" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const publicToken = (body.publicToken as string | undefined)?.trim();
  if (!publicToken) {
    return NextResponse.json({ error: "publicToken required" }, { status: 400 });
  }

  try {
    const { accessToken, itemId } = await exchangePublicToken(publicToken);
    const inst = await getItemInstitution(accessToken);

    const consentExpiresAt = inst.consentExpirationTime ?? new Date(Date.now() + NINETY_DAYS_MS);

    const conn = await prisma.bankConnection.create({
      data: {
        provider: "PLAID",
        providerName: inst.institutionId ?? "unknown",
        displayName: inst.institutionName ?? "Plaid Item",
        providerConnectionId: itemId,
        accessToken,
        consentExpiresAt,
        status: "ACTIVE",
        lastSyncedAt: new Date(),
      },
    });

    const accounts = await getAccounts(accessToken);
    for (const a of accounts) {
      await upsertAccountFromPlaid(conn.id, a, inst.institutionName ?? "Plaid");
    }

    return NextResponse.json({ connectionId: conn.id, accounts: accounts.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "exchange_failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

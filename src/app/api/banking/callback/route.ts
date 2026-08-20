// GET /api/banking/callback?code=...&state=...
// TrueLayer redirects here after the user consents. We exchange the code for
// tokens, pull accounts/cards/balances, link or create BankAccount rows, and
// redirect to /banking.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  exchangeCode,
  getAccounts,
  getCards,
  getAccountBalance,
  getCardBalance,
} from "@/lib/truelayer/client";
import {
  upsertAccountFromTrueLayer,
  upsertCardFromTrueLayer,
} from "@/lib/truelayer/upsert";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/banking?error=${encodeURIComponent(error)}`, req.url),
    );
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`/banking?error=missing_code`, req.url));
  }

  const conn = await prisma.bankConnection.findFirst({
    where: { status: "PENDING", providerConnectionId: state },
  });
  if (!conn) {
    return NextResponse.redirect(new URL(`/banking?error=invalid_state`, req.url));
  }

  try {
    const tokens = await exchangeCode(code);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const consentExpiresAt = new Date(Date.now() + NINETY_DAYS_MS);

    const [accountsRes, cardsRes] = await Promise.all([
      getAccounts(tokens.access_token).catch(() => ({ results: [] })),
      getCards(tokens.access_token).catch(() => ({ results: [] })),
    ]);

    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt,
        consentExpiresAt,
        status: "ACTIVE",
        providerConnectionId: null,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });

    for (const acct of accountsRes.results) {
      const balRes = await getAccountBalance(tokens.access_token, acct.account_id).catch(
        () => null,
      );
      const balance = balRes?.results?.[0] ?? null;
      await upsertAccountFromTrueLayer(conn.id, acct, balance);
    }
    for (const card of cardsRes.results) {
      const balRes = await getCardBalance(tokens.access_token, card.account_id).catch(
        () => null,
      );
      const balance = balRes?.results?.[0] ?? null;
      await upsertCardFromTrueLayer(conn.id, card, balance);
    }

    return NextResponse.redirect(new URL(`/banking?connected=${conn.id}`, req.url));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "exchange_failed";
    await prisma.bankConnection.update({
      where: { id: conn.id },
      data: { status: "ERROR", lastSyncError: msg.slice(0, 500) },
    });
    return NextResponse.redirect(
      new URL(`/banking?error=${encodeURIComponent(msg)}`, req.url),
    );
  }
}

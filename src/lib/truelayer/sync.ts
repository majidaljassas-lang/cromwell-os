// TrueLayer transaction sync engine.
//
// For each ACTIVE BankConnection:
//   - Refresh access token if expiring within 5 minutes
//   - For each linked BankAccount, pull transactions since last sync (or
//     90 days back on first run) using the right endpoint (card vs account)
//   - Upsert into BankTransaction keyed on (bankAccountId, fitId=TL tx id)
//   - Update balance + lastSyncedAt
//
// Connections whose 90-day SCA consent has expired are flipped to EXPIRED
// and skipped; the user must reconnect to resume.

import { prisma } from "@/lib/prisma";
import {
  refreshAccessToken,
  getAccountTransactions,
  getCardTransactions,
  getAccountBalance,
  getCardBalance,
  type TLTransaction,
} from "./client";

const DEFAULT_BACKFILL_DAYS = 90;
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // refresh if expires in <5min
const SYNC_OVERLAP_DAYS = 1; // refetch last day to catch late-postings

interface SyncSummary {
  connectionsProcessed: number;
  accountsProcessed: number;
  transactionsUpserted: number;
  errors: Array<{ connectionId: string; error: string }>;
  reauthRequired: string[]; // connection ids
}

export async function syncAllConnections(): Promise<SyncSummary> {
  const summary: SyncSummary = {
    connectionsProcessed: 0,
    accountsProcessed: 0,
    transactionsUpserted: 0,
    errors: [],
    reauthRequired: [],
  };

  const connections = await prisma.bankConnection.findMany({
    where: { provider: "TRUELAYER", status: { in: ["ACTIVE", "ERROR"] } },
    include: { accounts: { include: { account: true } } },
  });

  const now = new Date();

  for (const conn of connections) {
    summary.connectionsProcessed++;

    // 90-day SCA expiry — auto-flip and skip.
    if (conn.consentExpiresAt && conn.consentExpiresAt.getTime() < now.getTime()) {
      await prisma.bankConnection.update({
        where: { id: conn.id },
        data: { status: "EXPIRED" },
      });
      summary.reauthRequired.push(conn.id);
      continue;
    }

    try {
      const accessToken = await ensureFreshToken(conn);

      for (const acct of conn.accounts) {
        summary.accountsProcessed++;
        const isCard = acct.account.accountSubType === "CURRENT_LIABILITY";

        const fromDate = pickFromDate(acct.lastSyncedAt);
        const toDate = now;

        const txRes = isCard
          ? await getCardTransactions(
              accessToken,
              acct.providerAccountId!,
              fromDate.toISOString(),
              toDate.toISOString(),
            )
          : await getAccountTransactions(
              accessToken,
              acct.providerAccountId!,
              fromDate.toISOString(),
              toDate.toISOString(),
            );

        for (const tx of txRes.results) {
          const upserted = await upsertTransaction(acct.id, tx);
          if (upserted) summary.transactionsUpserted++;
        }

        // Balance refresh
        const balRes = isCard
          ? await getCardBalance(accessToken, acct.providerAccountId!).catch(() => null)
          : await getAccountBalance(accessToken, acct.providerAccountId!).catch(() => null);
        const newBalance = balRes?.results?.[0]?.current;

        await prisma.bankAccount.update({
          where: { id: acct.id },
          data: {
            lastSyncedAt: now,
            ...(newBalance !== undefined ? { currentBalance: newBalance } : {}),
          },
        });
      }

      await prisma.bankConnection.update({
        where: { id: conn.id },
        data: {
          status: "ACTIVE",
          lastSyncedAt: now,
          lastSyncError: null,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "sync_failed";
      summary.errors.push({ connectionId: conn.id, error: msg });

      // 401/403 typically means tokens revoked or consent expired — flag for reauth.
      const needsReauth =
        msg.includes("401") || msg.includes("403") || msg.toLowerCase().includes("invalid_grant");
      await prisma.bankConnection.update({
        where: { id: conn.id },
        data: {
          status: needsReauth ? "EXPIRED" : "ERROR",
          lastSyncError: msg.slice(0, 500),
        },
      });
      if (needsReauth) summary.reauthRequired.push(conn.id);
    }
  }

  return summary;
}

async function ensureFreshToken(conn: {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
}): Promise<string> {
  const now = Date.now();
  const expiringSoon =
    !conn.tokenExpiresAt || conn.tokenExpiresAt.getTime() - now < TOKEN_REFRESH_THRESHOLD_MS;

  if (!expiringSoon && conn.accessToken) return conn.accessToken;

  if (!conn.refreshToken) {
    throw new Error("no refresh_token on connection — reauth required");
  }

  const tokens = await refreshAccessToken(conn.refreshToken);
  const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.bankConnection.update({
    where: { id: conn.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? conn.refreshToken,
      tokenExpiresAt,
    },
  });

  return tokens.access_token;
}

function pickFromDate(lastSyncedAt: Date | null): Date {
  if (!lastSyncedAt) {
    return new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  }
  return new Date(lastSyncedAt.getTime() - SYNC_OVERLAP_DAYS * 24 * 60 * 60 * 1000);
}

// Upsert a TrueLayer transaction. Returns true if a new row was inserted.
async function upsertTransaction(bankAccountId: string, tx: TLTransaction): Promise<boolean> {
  const existing = await prisma.bankTransaction.findUnique({
    where: { bankAccountId_fitId: { bankAccountId, fitId: tx.transaction_id } },
  });

  const data = {
    transactionDate: new Date(tx.timestamp),
    amount: tx.amount,
    transactionType: mapTransactionType(tx),
    description: tx.description.slice(0, 500),
    reference: tx.merchant_name?.slice(0, 200) ?? null,
    runningBalance: tx.running_balance?.amount ?? null,
  };

  if (existing) {
    // Refresh mutable fields without changing reconciliation status.
    await prisma.bankTransaction.update({
      where: { id: existing.id },
      data,
    });
    return false;
  }

  await prisma.bankTransaction.create({
    data: {
      bankAccountId,
      fitId: tx.transaction_id,
      ...data,
      reconciliationStatus: "UNRECONCILED",
      importedAt: new Date(),
    },
  });
  return true;
}

function mapTransactionType(tx: TLTransaction): string {
  // Existing schema uses string types: DEPOSIT, WITHDRAWAL, TRANSFER, BANK_CHARGE, INTEREST.
  const cat = (tx.transaction_category || "").toUpperCase();
  if (cat === "TRANSFER") return "TRANSFER";
  if (cat === "BANK_CHARGE" || cat === "FEE_CHARGE") return "BANK_CHARGE";
  if (cat === "INTEREST") return "INTEREST";
  return tx.transaction_type === "CREDIT" ? "DEPOSIT" : "WITHDRAWAL";
}

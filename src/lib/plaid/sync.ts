// Plaid /transactions/sync engine.
//
// For each ACTIVE Plaid BankConnection:
//   - Walk /transactions/sync with the stored cursor until has_more=false
//   - Upsert added/modified into BankTransaction
//   - Soft-delete removed (mark reconciliationStatus=EXCLUDED)
//   - Persist new cursor + lastSyncedAt
//
// Connections whose 90-day consent has expired -> status=EXPIRED, skip.
// 401/INVALID_ACCESS_TOKEN -> status=EXPIRED, surface for reauth.

import { prisma } from "@/lib/prisma";
import { syncTransactions } from "./client";
import type { Transaction, RemovedTransaction } from "plaid";

interface PlaidSyncSummary {
  connectionsProcessed: number;
  accountsProcessed: number;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  errors: Array<{ connectionId: string; error: string }>;
  reauthRequired: string[];
}

export async function syncAllPlaidConnections(): Promise<PlaidSyncSummary> {
  const summary: PlaidSyncSummary = {
    connectionsProcessed: 0,
    accountsProcessed: 0,
    transactionsAdded: 0,
    transactionsModified: 0,
    transactionsRemoved: 0,
    errors: [],
    reauthRequired: [],
  };

  const connections = await prisma.bankConnection.findMany({
    where: { provider: "PLAID", status: { in: ["ACTIVE", "ERROR"] } },
    include: { accounts: true },
  });

  const now = new Date();

  for (const conn of connections) {
    summary.connectionsProcessed++;

    if (conn.consentExpiresAt && conn.consentExpiresAt.getTime() < now.getTime()) {
      await prisma.bankConnection.update({
        where: { id: conn.id },
        data: { status: "EXPIRED" },
      });
      summary.reauthRequired.push(conn.id);
      continue;
    }

    if (!conn.accessToken) {
      summary.errors.push({ connectionId: conn.id, error: "no_access_token" });
      continue;
    }

    summary.accountsProcessed += conn.accounts.length;

    try {
      const result = await syncOneConnection(conn.id, conn.accessToken, conn.cursor);
      summary.transactionsAdded += result.added;
      summary.transactionsModified += result.modified;
      summary.transactionsRemoved += result.removed;

      await prisma.bankConnection.update({
        where: { id: conn.id },
        data: {
          cursor: result.nextCursor,
          status: "ACTIVE",
          lastSyncedAt: now,
          lastSyncError: null,
        },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "sync_failed";
      summary.errors.push({ connectionId: conn.id, error: msg });
      const needsReauth =
        msg.includes("INVALID_ACCESS_TOKEN") ||
        msg.includes("ITEM_LOGIN_REQUIRED") ||
        msg.includes("PENDING_EXPIRATION") ||
        msg.includes("401");
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

interface OneSyncResult {
  added: number;
  modified: number;
  removed: number;
  nextCursor: string;
}

async function syncOneConnection(
  connectionId: string,
  accessToken: string,
  startCursor: string | null,
): Promise<OneSyncResult> {
  let cursor = startCursor;
  const added: Transaction[] = [];
  const modified: Transaction[] = [];
  const removed: RemovedTransaction[] = [];

  // Loop until Plaid has no more pages.
  while (true) {
    const data = await syncTransactions(accessToken, cursor);
    added.push(...data.added);
    modified.push(...data.modified);
    removed.push(...data.removed);
    cursor = data.next_cursor;
    if (!data.has_more) break;
  }

  // Map provider account ids -> our BankAccount ids in one query.
  const accounts = await prisma.bankAccount.findMany({
    where: { connectionId },
    select: { id: true, providerAccountId: true },
  });
  const acctMap = new Map(accounts.map((a) => [a.providerAccountId, a.id]));

  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;

  for (const tx of added) {
    const bankAccountId = acctMap.get(tx.account_id);
    if (!bankAccountId) continue;
    const existing = await prisma.bankTransaction.findUnique({
      where: { bankAccountId_fitId: { bankAccountId, fitId: tx.transaction_id } },
    });
    const data = mapTxnFields(tx);
    if (existing) {
      await prisma.bankTransaction.update({ where: { id: existing.id }, data });
      modifiedCount++;
    } else {
      await prisma.bankTransaction.create({
        data: {
          bankAccountId,
          fitId: tx.transaction_id,
          ...data,
          reconciliationStatus: "UNRECONCILED",
          importedAt: new Date(),
        },
      });
      addedCount++;
    }
  }

  for (const tx of modified) {
    const bankAccountId = acctMap.get(tx.account_id);
    if (!bankAccountId) continue;
    const existing = await prisma.bankTransaction.findUnique({
      where: { bankAccountId_fitId: { bankAccountId, fitId: tx.transaction_id } },
    });
    if (!existing) continue;
    await prisma.bankTransaction.update({
      where: { id: existing.id },
      data: mapTxnFields(tx),
    });
    modifiedCount++;
  }

  for (const r of removed) {
    if (!r.transaction_id) continue;
    const existing = await prisma.bankTransaction.findFirst({
      where: { fitId: r.transaction_id },
    });
    if (!existing) continue;
    await prisma.bankTransaction.update({
      where: { id: existing.id },
      data: { reconciliationStatus: "EXCLUDED", notes: "Removed by Plaid" },
    });
    removedCount++;
  }

  return {
    added: addedCount,
    modified: modifiedCount,
    removed: removedCount,
    nextCursor: cursor ?? "",
  };
}

function mapTxnFields(tx: Transaction) {
  // Plaid amounts: positive = money out (debit), negative = money in (credit).
  // Our schema convention: amount is the signed transaction amount; we also
  // record transactionType. We invert the sign so credits are positive.
  const signed = -1 * tx.amount;
  const txType = signed > 0 ? "DEPOSIT" : "WITHDRAWAL";

  const description = (tx.merchant_name || tx.name || "").slice(0, 500);
  const reference = tx.payment_meta?.reference_number?.slice(0, 200) ?? null;

  return {
    transactionDate: new Date(tx.date),
    amount: signed,
    transactionType: txType,
    description,
    reference,
  };
}

// Sync just one connection (used by webhook handler when Plaid signals new data).
export async function syncOnePlaidConnection(connectionId: string): Promise<OneSyncResult | null> {
  const conn = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
  });
  if (!conn || conn.provider !== "PLAID" || !conn.accessToken) return null;

  try {
    const result = await syncOneConnection(connectionId, conn.accessToken, conn.cursor);
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: {
        cursor: result.nextCursor,
        status: "ACTIVE",
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "sync_failed";
    const needsReauth =
      msg.includes("INVALID_ACCESS_TOKEN") ||
      msg.includes("ITEM_LOGIN_REQUIRED") ||
      msg.includes("PENDING_EXPIRATION") ||
      msg.includes("401");
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: {
        status: needsReauth ? "EXPIRED" : "ERROR",
        lastSyncError: msg.slice(0, 500),
      },
    });
    throw e;
  }
}

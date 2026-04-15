/**
 * Enable Banking sync logic — called from POST /api/enable-banking/sync.
 *
 * For each active ENABLE_BANKING IngestionSource:
 *   1. listAccounts → upsert BankAccount rows
 *   2. For each account, fetch transactions since lastSyncAt (or 30 days)
 *   3. Upsert into BankTransaction (dedupe on fitId = Enable's transaction_id)
 *   4. Run lightweight auto-reconciliation hints
 *   5. Update lastSyncAt + connectorStatus on the source
 *
 * Fully idempotent. Reconciliation is SUGGESTIONS ONLY — never auto-posts.
 */

import { prisma } from "@/lib/prisma";
import {
  listAccounts,
  getBalance,
  pickBalance,
  listAllTransactions,
  EnableTransaction,
} from "./client";

// ─── Helpers ───────────────────────────────────────────────────────────────

function toDate(d: string | null | undefined): Date {
  return d ? new Date(d) : new Date();
}

function classifyType(txn: EnableTransaction): string {
  const amt = parseFloat(txn.transaction_amount.amount);
  const code = (txn.proprietary_bank_transaction_code ?? "").toUpperCase();
  if (code.includes("CHARGE") || code.includes("FEE")) return "BANK_CHARGE";
  if (code.includes("INT")) return "INTEREST";
  if (code.includes("TRANSFER") || code.includes("TRF")) return "TRANSFER";
  return amt >= 0 ? "DEPOSIT" : "WITHDRAWAL";
}

/** Strip inv/bill number candidates from a reference string */
function extractRef(text: string | null): string[] {
  if (!text) return [];
  // Match patterns like INV-1234, SI-001, BILL-99, or plain numbers 4-8 digits
  const matches = text.match(/\b(?:INV|SI|SINV|BILL|BL|PO|INV#|BILL#)[-\s]?(\w+)\b|\b\d{4,8}\b/gi);
  return matches ?? [];
}

// ─── Main sync ────────────────────────────────────────────────────────────

export interface SyncResult {
  sourcesProcessed: number;
  accountsUpserted: number;
  transactionsUpserted: number;
  transactionsSkipped: number;
  suggestionsCreated: number;
  errors: string[];
  reauthRequired: string[];
}

export async function syncEnableBanking(): Promise<SyncResult> {
  const result: SyncResult = {
    sourcesProcessed: 0,
    accountsUpserted: 0,
    transactionsUpserted: 0,
    transactionsSkipped: 0,
    suggestionsCreated: 0,
    errors: [],
    reauthRequired: [],
  };

  const sources = await prisma.ingestionSource.findMany({
    where: { sourceType: "ENABLE_BANKING", isActive: true },
  });

  for (const source of sources) {
    const sessionId = source.externalRef;
    if (!sessionId) {
      result.errors.push(`Source ${source.id}: no sessionId — needs auth`);
      continue;
    }

    try {
      // 1. Fetch accounts
      const enableAccounts = await listAccounts(sessionId);

      for (const ea of enableAccounts) {
        // 2. Get balance
        let balance = 0;
        try {
          const bals = await getBalance(sessionId, ea.uid);
          balance = pickBalance(bals);
        } catch {
          // Non-fatal — balance will stay at previous value
        }

        // 3. Derive sort code / account number from bban (format: "SSSSSSAAAAAAAA" or "SSSSSS AAAAAAAA")
        const bbanClean = (ea.bban ?? "").replace(/\s/g, "");
        const sortCode = bbanClean.slice(0, 6) || "000000";
        const accountNumber = bbanClean.slice(6) || (ea.iban?.slice(-8) ?? "00000000");

        // 4. Upsert BankAccount — match by Enable account UID stored in enableAccountId
        // We must link to a ChartOfAccount row; try to find or create a default one
        let chartAccount = await prisma.chartOfAccount.findFirst({
          where: {
            OR: [
              { accountCode: `BANK-${ea.uid.slice(0, 8).toUpperCase()}` },
              { bankAccount: { enableAccountId: ea.uid } },
            ],
          },
        });

        if (!chartAccount) {
          // Find the first existing bank-type ChartOfAccount to attach to, or create one
          chartAccount = await prisma.chartOfAccount.findFirst({
            where: { accountType: "ASSET", accountSubType: "BANK" },
          });

          if (!chartAccount) {
            chartAccount = await prisma.chartOfAccount.create({
              data: {
                accountCode: `BANK-${ea.uid.slice(0, 8).toUpperCase()}`,
                accountName: ea.name || ea.product || "Enable Banking Account",
                accountType: "ASSET",
                accountSubType: "BANK",
                isActive: true,
                currentBalance: balance,
              },
            });
          }
        }

        const bankAccount = await prisma.bankAccount.upsert({
          where: { enableAccountId: ea.uid },
          update: {
            currentBalance: balance,
            lastSyncedAt: new Date(),
            enableSessionId: sessionId,
          },
          create: {
            accountId: chartAccount.id,
            bankName: "Barclays",
            accountName: ea.name ?? ea.product ?? "Enable Banking Account",
            accountNumber,
            sortCode,
            currency: ea.currency ?? "GBP",
            currentBalance: balance,
            enableSessionId: sessionId,
            enableAccountId: ea.uid,
            lastSyncedAt: new Date(),
            isActive: true,
          },
        });

        result.accountsUpserted++;

        // 5. Fetch transactions since lastSyncAt or 30 days ago
        const syncCutoff = source.lastSyncAt
          ? new Date(source.lastSyncAt.getTime() - 86_400_000) // 1-day overlap for safety
          : new Date(Date.now() - 30 * 86_400_000);
        const fromDate = syncCutoff.toISOString().slice(0, 10);

        let txns: EnableTransaction[] = [];
        try {
          txns = await listAllTransactions(sessionId, ea.uid, { fromDate });
        } catch (e) {
          result.errors.push(`Transactions fetch failed for account ${ea.uid}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }

        for (const txn of txns) {
          if (!txn.transaction_id) continue;

          const amount = parseFloat(txn.transaction_amount.amount);
          const description =
            txn.remittance_information_unstructured ??
            txn.creditor_name ??
            txn.debtor_name ??
            txn.proprietary_bank_transaction_code ??
            "No description";
          const txDate = toDate(txn.booking_date ?? txn.value_date);
          const runningBalance = txn.balance_after_transaction
            ? parseFloat(txn.balance_after_transaction.balance_amount.amount)
            : null;

          const existing = await prisma.bankTransaction.findUnique({
            where: { bankAccountId_fitId: { bankAccountId: bankAccount.id, fitId: txn.transaction_id } },
          });

          if (existing) {
            result.transactionsSkipped++;
            continue;
          }

          const newTxn = await prisma.bankTransaction.create({
            data: {
              bankAccountId: bankAccount.id,
              transactionDate: txDate,
              amount,
              transactionType: classifyType(txn),
              description,
              reference: txn.entry_reference ?? null,
              fitId: txn.transaction_id,
              runningBalance,
              reconciliationStatus: "UNRECONCILED",
              importedAt: new Date(),
            },
          });

          result.transactionsUpserted++;

          // 6. Auto-reconciliation hints
          const refs = extractRef(description).concat(extractRef(txn.entry_reference));
          if (refs.length > 0) {
            const suggestion = await raiseSuggestion(newTxn.id, refs, amount);
            if (suggestion) result.suggestionsCreated++;
          }
        }
      }

      // 7. Mark source synced
      await prisma.ingestionSource.update({
        where: { id: source.id },
        data: { lastSyncAt: new Date(), connectorStatus: "OK" },
      });

      result.sourcesProcessed++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Detect auth expiry (Enable returns 401 when session expires)
      if (msg.includes("401")) {
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: { connectorStatus: "REAUTH_REQUIRED" },
        });
        result.reauthRequired.push(source.id);
      } else {
        result.errors.push(`Source ${source.id}: ${msg}`);
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: { connectorStatus: `ERROR: ${msg.slice(0, 200)}` },
        });
      }
    }
  }

  return result;
}

// ─── Suggestion engine ────────────────────────────────────────────────────

async function raiseSuggestion(
  bankTransactionId: string,
  refs: string[],
  amount: number
): Promise<boolean> {
  // Try to find a matching SalesInvoice
  for (const ref of refs) {
    const inv = await prisma.salesInvoice.findFirst({
      where: {
        OR: [
          { invoiceNo: { contains: ref, mode: "insensitive" } },
          { invoiceNo: ref },
        ],
      },
    });
    if (inv) {
      await prisma.bankTransactionMatch.upsert({
        where: { bankTransactionId },
        update: { matchedRecordId: inv.id, matchedRecordRef: inv.invoiceNo ?? ref, confidenceScore: 75 },
        create: {
          bankTransactionId,
          matchType: "INVOICE",
          matchedRecordId: inv.id,
          matchedRecordRef: inv.invoiceNo ?? ref,
          confidenceScore: 75,
        },
      });
      // Update the transaction status to flag it has a suggestion
      await prisma.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { reconciliationStatus: "MATCHED", notes: `Suggested: Invoice ${inv.invoiceNo ?? ref}` },
      });
      return true;
    }

    // Try to find a matching SupplierBill
    const bill = await prisma.supplierBill.findFirst({
      where: {
        OR: [
          { billNo: { contains: ref, mode: "insensitive" } },
          { billNo: ref },
        ],
      },
    });
    if (bill) {
      await prisma.bankTransactionMatch.upsert({
        where: { bankTransactionId },
        update: { matchedRecordId: bill.id, matchedRecordRef: bill.billNo, confidenceScore: 75 },
        create: {
          bankTransactionId,
          matchType: "BILL",
          matchedRecordId: bill.id,
          matchedRecordRef: bill.billNo,
          confidenceScore: 75,
        },
      });
      await prisma.bankTransaction.update({
        where: { id: bankTransactionId },
        data: { reconciliationStatus: "MATCHED", notes: `Suggested: Bill ${bill.billNo}` },
      });
      return true;
    }
  }

  return false;
}

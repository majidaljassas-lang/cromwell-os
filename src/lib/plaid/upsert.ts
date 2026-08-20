// Upsert Plaid AccountBase rows into our BankAccount table.
// Mirrors src/lib/truelayer/upsert.ts shape. Plaid accounts come in two flavours
// for our needs:
//   - depository (current/savings) -> ASSET / BANK -> BankAccount
//   - credit (Barclaycard etc.)    -> LIABILITY / CURRENT_LIABILITY -> BankAccount
// Both land in the same BankAccount table (existing schema design).

import { prisma } from "@/lib/prisma";
import type { AccountBase } from "plaid";

async function nextAccountCode(prefix: string): Promise<string> {
  const rows = await prisma.chartOfAccount.findMany({
    where: { accountCode: { startsWith: prefix } },
    select: { accountCode: true },
  });
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.accountCode, 10);
    if (!isNaN(n) && n > max) max = n;
  }
  if (max < parseInt(prefix + "00", 10)) max = parseInt(prefix + "00", 10);
  return String(max + 1);
}

export async function upsertAccountFromPlaid(
  connectionId: string,
  acct: AccountBase,
  bankName: string,
) {
  const isCredit = acct.type === "credit";
  // Plaid masks the account number to last-4 ("mask"). Real number is only
  // available via /auth (not what we want here). For matching to seed rows
  // in the existing ledger, last-4 is the best identifier we have.
  const mask = acct.mask ?? "";

  // Try to reattach to an existing orphan row by mask only (last-4).
  let bank = null;
  if (mask) {
    bank = await prisma.bankAccount.findFirst({
      where: { connectionId: null, accountNumber: mask },
    });
  }

  const balance = acct.balances.current ?? 0;

  if (bank) {
    return prisma.bankAccount.update({
      where: { id: bank.id },
      data: {
        connectionId,
        providerAccountId: acct.account_id,
        currentBalance: balance,
        lastSyncedAt: new Date(),
      },
    });
  }

  // New row — create matching ChartOfAccount first.
  const codePrefix = isCredit ? "21" : "10";
  const code = await nextAccountCode(codePrefix);
  const chart = await prisma.chartOfAccount.create({
    data: {
      accountCode: code,
      accountName: acct.name || `${bankName} ${acct.subtype ?? acct.type}`,
      accountType: isCredit ? "LIABILITY" : "ASSET",
      accountSubType: isCredit ? "CURRENT_LIABILITY" : "BANK",
      isSystemAccount: false,
      isActive: true,
      openingBalance: 0,
      currentBalance: balance,
    },
  });

  return prisma.bankAccount.create({
    data: {
      accountId: chart.id,
      connectionId,
      providerAccountId: acct.account_id,
      bankName,
      accountName: acct.official_name || acct.name,
      accountNumber: mask,
      sortCode: "",
      currency: acct.balances.iso_currency_code ?? "GBP",
      currentBalance: balance,
      isDefault: false,
      isActive: true,
      lastSyncedAt: new Date(),
    },
  });
}

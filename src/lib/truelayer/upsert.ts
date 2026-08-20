// On callback we receive 1+ accounts and/or cards from TrueLayer.
// For each:
//   - If a BankAccount already exists with matching sort code + account number
//     (current accounts) or partial card number (cards), LINK it to this
//     connection. Don't duplicate the seed Barclays account.
//   - Otherwise, create a new BankAccount + new ChartOfAccount.

import { prisma } from "@/lib/prisma";
import type { TLAccount, TLCard, TLBalance, TLCardBalance } from "./client";

function normaliseSortCode(s: string | undefined | null): string | null {
  if (!s) return null;
  // TrueLayer returns sort codes as "204545"; we store as "20-45-45".
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length !== 6) return s;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
}

async function nextAccountCode(prefix: string): Promise<string> {
  // ChartOfAccount.accountCode is a string. Find the highest existing 4-digit
  // code starting with `prefix` and return prefix + (max + 1).
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

export async function upsertAccountFromTrueLayer(
  connectionId: string,
  tl: TLAccount,
  balance: TLBalance | null,
) {
  const sortCode = normaliseSortCode(tl.account_number.sort_code);
  const accountNumber = tl.account_number.number ?? null;

  let bank = null;
  if (sortCode && accountNumber) {
    bank = await prisma.bankAccount.findFirst({
      where: { sortCode, accountNumber },
    });
  }

  if (bank) {
    return prisma.bankAccount.update({
      where: { id: bank.id },
      data: {
        connectionId,
        providerAccountId: tl.account_id,
        currentBalance: balance?.current ?? bank.currentBalance,
        lastSyncedAt: new Date(),
      },
    });
  }

  // New account — create ChartOfAccount (ASSET / BANK) + BankAccount.
  const code = await nextAccountCode("10"); // 1000-1099 is bank range
  const chart = await prisma.chartOfAccount.create({
    data: {
      accountCode: code,
      accountName: tl.display_name || `${tl.provider.display_name} ${tl.account_type}`,
      accountType: "ASSET",
      accountSubType: "BANK",
      isSystemAccount: false,
      isActive: true,
      openingBalance: 0,
      currentBalance: balance?.current ?? 0,
    },
  });
  return prisma.bankAccount.create({
    data: {
      accountId: chart.id,
      connectionId,
      providerAccountId: tl.account_id,
      bankName: tl.provider.display_name,
      accountName: tl.display_name,
      accountNumber: accountNumber ?? "",
      sortCode: sortCode ?? "",
      currency: tl.currency,
      currentBalance: balance?.current ?? 0,
      isDefault: false,
      isActive: true,
      lastSyncedAt: new Date(),
    },
  });
}

export async function upsertCardFromTrueLayer(
  connectionId: string,
  tl: TLCard,
  balance: TLCardBalance | null,
) {
  const partial = tl.partial_card_number; // last 4 digits typically
  let bank = null;
  if (partial) {
    bank = await prisma.bankAccount.findFirst({
      where: { accountNumber: partial },
    });
  }

  // Cards are LIABILITY (CURRENT_LIABILITY). Card balance.current is what's owed.
  if (bank) {
    return prisma.bankAccount.update({
      where: { id: bank.id },
      data: {
        connectionId,
        providerAccountId: tl.account_id,
        currentBalance: balance?.current ?? bank.currentBalance,
        lastSyncedAt: new Date(),
      },
    });
  }

  const code = await nextAccountCode("21"); // 2100-2199 is current liability range
  const chart = await prisma.chartOfAccount.create({
    data: {
      accountCode: code,
      accountName: tl.display_name || `${tl.provider.display_name} ${tl.card_type}`,
      accountType: "LIABILITY",
      accountSubType: "CURRENT_LIABILITY",
      isSystemAccount: false,
      isActive: true,
      openingBalance: 0,
      currentBalance: balance?.current ?? 0,
    },
  });
  return prisma.bankAccount.create({
    data: {
      accountId: chart.id,
      connectionId,
      providerAccountId: tl.account_id,
      bankName: tl.provider.display_name,
      accountName: tl.display_name,
      accountNumber: partial ?? "",
      sortCode: "",
      currency: tl.currency,
      currentBalance: balance?.current ?? 0,
      isDefault: false,
      isActive: true,
      lastSyncedAt: new Date(),
    },
  });
}

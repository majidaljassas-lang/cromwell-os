import { prisma } from "@/lib/prisma";
import { BankInboxBoard } from "./BankInboxBoard";

export const dynamic = "force-dynamic";

export default async function BankInboxPage() {
  const [unreconciled, matched, cleared, expenseAccounts, bankAccounts] =
    await Promise.all([
      prisma.bankTransaction.findMany({
        where: { reconciliationStatus: "UNRECONCILED" },
        orderBy: { transactionDate: "desc" },
        take: 100,
        include: {
          bankAccount: { select: { bankName: true, accountName: true } },
        },
      }),
      prisma.bankTransaction.findMany({
        where: { reconciliationStatus: "MATCHED" },
        orderBy: { transactionDate: "desc" },
        take: 50,
        include: {
          bankAccount: { select: { bankName: true, accountName: true } },
        },
      }),
      prisma.bankTransaction.findMany({
        where: { reconciliationStatus: "RECONCILED" },
        orderBy: { transactionDate: "desc" },
        take: 50,
        include: {
          bankAccount: { select: { bankName: true, accountName: true } },
        },
      }),
      // Counterparty accounts for direct categorization (excludes bank/control)
      prisma.chartOfAccount.findMany({
        where: {
          isActive: true,
          accountSubType: {
            in: [
              "OPERATING_EXPENSE",
              "COST_OF_GOODS_SOLD",
              "REVENUE",
              "EQUITY",
              "CURRENT_ASSET",
              "CURRENT_LIABILITY",
            ],
          },
          accountCode: { notIn: ["1100", "2000"] }, // exclude AR/AP control
        },
        orderBy: { accountCode: "asc" },
      }),
      prisma.bankAccount.findMany({
        where: { isActive: true },
        select: { id: true, bankName: true, accountName: true },
      }),
    ]);

  type Row = {
    id: string;
    transactionDate: string;
    amount: number;
    description: string;
    reference: string | null;
    transactionType: string;
    bankName: string;
  };
  const toRow = (t: typeof unreconciled[number]): Row => ({
    id: t.id,
    transactionDate: t.transactionDate.toISOString(),
    amount: Number(t.amount),
    description: t.description,
    reference: t.reference,
    transactionType: t.transactionType,
    bankName: t.bankAccount.bankName,
  });

  const accountOptions = expenseAccounts.map((a) => ({
    id: a.id,
    code: a.accountCode,
    name: a.accountName,
    type: a.accountType,
  }));

  const totalUnreconciled = unreconciled.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          BANK INBOX
        </h1>
        <div className="text-[11px] text-[#888888] tabular-nums uppercase tracking-widest">
          {unreconciled.length} unreconciled · £{totalUnreconciled.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} pending
        </div>
      </div>

      <BankInboxBoard
        unreconciled={unreconciled.map(toRow)}
        matched={matched.map(toRow)}
        cleared={cleared.map(toRow)}
        accounts={accountOptions}
      />
    </div>
  );
}

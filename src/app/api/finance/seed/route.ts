import { prisma } from "@/lib/prisma";

const accounts = [
  { accountCode: "1000", accountName: "Barclays Current Account", accountType: "ASSET", accountSubType: "BANK", isSystemAccount: true },
  { accountCode: "1100", accountName: "Trade Debtors", accountType: "ASSET", accountSubType: "CURRENT_ASSET", isSystemAccount: true },
  { accountCode: "1200", accountName: "Other Debtors", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1300", accountName: "VAT Input", accountType: "ASSET", accountSubType: "CURRENT_ASSET", isSystemAccount: true },
  { accountCode: "1400", accountName: "Stock on Hand", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1500", accountName: "Petty Cash", accountType: "ASSET", accountSubType: "BANK" },
  { accountCode: "2000", accountName: "Trade Creditors", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY", isSystemAccount: true },
  { accountCode: "2100", accountName: "VAT Output", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY", isSystemAccount: true },
  { accountCode: "2200", accountName: "HMRC VAT Liability", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2300", accountName: "Other Creditors", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "3000", accountName: "Share Capital", accountType: "EQUITY", accountSubType: "EQUITY" },
  { accountCode: "3100", accountName: "Retained Earnings", accountType: "EQUITY", accountSubType: "EQUITY", isSystemAccount: true },
  { accountCode: "3200", accountName: "Owner Drawings", accountType: "EQUITY", accountSubType: "EQUITY" },
  { accountCode: "4000", accountName: "Materials Sales", accountType: "INCOME", accountSubType: "REVENUE", isSystemAccount: true },
  { accountCode: "4100", accountName: "Labour Sales", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4200", accountName: "Delivery Income", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "5000", accountName: "Materials Purchased", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD", isSystemAccount: true },
  { accountCode: "5100", accountName: "Subcontractor Labour", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5200", accountName: "Delivery Costs", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5300", accountName: "Absorbed Costs", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "6000", accountName: "Rent", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6100", accountName: "Utilities", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6200", accountName: "Insurance", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6300", accountName: "Vehicle Expenses", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6400", accountName: "Office & Admin", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6500", accountName: "Bank Charges", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6600", accountName: "Professional Fees", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6700", accountName: "Bad Debts", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
];

const taxRates = [
  { name: "Standard Rate (20%)", rate: 20, taxType: "OUTPUT", isDefault: true, hmrcBoxNumber: 1 },
  { name: "Standard Rate Input (20%)", rate: 20, taxType: "INPUT", isDefault: false, hmrcBoxNumber: 4 },
  { name: "Zero Rated (0%)", rate: 0, taxType: "OUTPUT", isDefault: false },
  { name: "Exempt", rate: 0, taxType: "NONE", isDefault: false },
];

export async function POST() {
  try {
    // Seed accounts
    let created = 0;
    for (const acct of accounts) {
      await prisma.chartOfAccount.upsert({
        where: { accountCode: acct.accountCode },
        update: { accountName: acct.accountName, accountType: acct.accountType, accountSubType: acct.accountSubType },
        create: { ...acct, isSystemAccount: acct.isSystemAccount ?? false },
      });
      created++;
    }

    // Seed tax rates
    for (const tr of taxRates) {
      const existing = await prisma.taxRate.findFirst({ where: { name: tr.name } });
      if (!existing) {
        await prisma.taxRate.create({ data: tr });
      }
    }

    // Seed bank account linked to COA 1000
    const barclaysAccount = await prisma.chartOfAccount.findUnique({ where: { accountCode: "1000" } });
    if (barclaysAccount) {
      const existingBank = await prisma.bankAccount.findUnique({ where: { accountId: barclaysAccount.id } });
      if (!existingBank) {
        await prisma.bankAccount.create({
          data: {
            accountId: barclaysAccount.id,
            bankName: "Barclays Bank PLC",
            accountName: "Cromwell Plumbing Ltd",
            accountNumber: "93602001",
            sortCode: "20-45-45",
            isDefault: true,
          },
        });
      }
    }

    return Response.json({ ok: true, accounts: created, taxRates: taxRates.length, message: "Finance seed complete" });
  } catch (error) {
    console.error("Finance seed failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Seed failed" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

// Cromwell Plumbing — wholesaler chart of accounts.
// Existing codes preserved (4000/4100/4200) so historical AP postings keep referring.
// New revenue streams (4020 Project, 4030 Hire) added in gaps; renames are name-only.
const accounts = [
  // Assets
  { accountCode: "1000", accountName: "Barclays Current Account", accountType: "ASSET", accountSubType: "BANK", isSystemAccount: true },
  { accountCode: "1100", accountName: "Trade Debtors", accountType: "ASSET", accountSubType: "CURRENT_ASSET", isSystemAccount: true },
  { accountCode: "1200", accountName: "Other Debtors", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1300", accountName: "VAT Input", accountType: "ASSET", accountSubType: "CURRENT_ASSET", isSystemAccount: true },
  { accountCode: "1400", accountName: "Stock on Hand", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1410", accountName: "Stock In Transit", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1420", accountName: "Stock Pending Return-to-Supplier", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1500", accountName: "Petty Cash", accountType: "ASSET", accountSubType: "BANK" },

  // Liabilities
  { accountCode: "2000", accountName: "Trade Creditors", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY", isSystemAccount: true },
  { accountCode: "2100", accountName: "VAT Output", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY", isSystemAccount: true },
  { accountCode: "2200", accountName: "HMRC VAT Liability", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2300", accountName: "Other Creditors", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2400", accountName: "Customer Deposits", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2500", accountName: "Accruals", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },

  // Equity
  { accountCode: "3000", accountName: "Share Capital", accountType: "EQUITY", accountSubType: "EQUITY" },
  { accountCode: "3100", accountName: "Retained Earnings", accountType: "EQUITY", accountSubType: "EQUITY", isSystemAccount: true },
  { accountCode: "3200", accountName: "Owner Drawings", accountType: "EQUITY", accountSubType: "EQUITY" },

  // Income — wholesaler revenue streams
  { accountCode: "4000", accountName: "Sales — Materials", accountType: "INCOME", accountSubType: "REVENUE", isSystemAccount: true },
  { accountCode: "4020", accountName: "Sales — Project (Labour + Materials)", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4030", accountName: "Hire Income", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4100", accountName: "Sales — Labour (Drawdown POs)", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4200", accountName: "Carriage / Logistics Charged", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4900", accountName: "Sundry Income", accountType: "INCOME", accountSubType: "REVENUE" },

  // Cost of Sales
  { accountCode: "5000", accountName: "Materials Purchased", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD", isSystemAccount: true },
  { accountCode: "5050", accountName: "Discounts Received (Suppliers)", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5060", accountName: "Returns Outwards", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5070", accountName: "Stock Movement Adjustment", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5080", accountName: "Stock Write-Off", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5100", accountName: "Subcontractor / Site Labour", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5200", accountName: "Carriage In", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
  { accountCode: "5300", accountName: "Absorbed Costs", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },

  // Operating expenses
  { accountCode: "6000", accountName: "Rent", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6100", accountName: "Utilities", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6200", accountName: "Insurance", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6300", accountName: "Vehicle Expenses", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6400", accountName: "Office & Admin", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6500", accountName: "Bank Charges", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6600", accountName: "Professional Fees", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6700", accountName: "Bad Debts", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6800", accountName: "Wages & Salaries", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6810", accountName: "Employer NIC", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6820", accountName: "Pension Contributions", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6900", accountName: "Software & Subscriptions", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6910", accountName: "Marketing", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
  { accountCode: "6920", accountName: "Telephone & Internet", accountType: "EXPENSE", accountSubType: "OPERATING_EXPENSE" },
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

import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 5000,
  connectionTimeoutMillis: 10000,
  allowExitOnIdle: true,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Chart of Accounts ───────────────────────────────────────────────────────

const accounts = [
  { accountCode: "1000", accountName: "Barclays Current Account", accountType: "ASSET", accountSubType: "BANK" },
  { accountCode: "1100", accountName: "Trade Debtors", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1200", accountName: "Other Debtors", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1300", accountName: "VAT Input", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1400", accountName: "Stock on Hand", accountType: "ASSET", accountSubType: "CURRENT_ASSET" },
  { accountCode: "1500", accountName: "Petty Cash", accountType: "ASSET", accountSubType: "BANK" },
  { accountCode: "2000", accountName: "Trade Creditors", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2100", accountName: "VAT Output", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2200", accountName: "HMRC VAT Liability", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "2300", accountName: "Other Creditors", accountType: "LIABILITY", accountSubType: "CURRENT_LIABILITY" },
  { accountCode: "3000", accountName: "Share Capital", accountType: "EQUITY", accountSubType: "EQUITY" },
  { accountCode: "3100", accountName: "Retained Earnings", accountType: "EQUITY", accountSubType: "EQUITY" },
  { accountCode: "3200", accountName: "Owner Drawings", accountType: "EQUITY", accountSubType: "EQUITY" },
  { accountCode: "4000", accountName: "Materials Sales", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4100", accountName: "Labour Sales", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "4200", accountName: "Delivery Income", accountType: "INCOME", accountSubType: "REVENUE" },
  { accountCode: "5000", accountName: "Materials Purchased", accountType: "EXPENSE", accountSubType: "COST_OF_GOODS_SOLD" },
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
] as const;

// ─── Tax Rates ───────────────────────────────────────────────────────────────

const taxRates = [
  { name: "Standard Rate", rate: 20, taxType: "OUTPUT", isDefault: true, hmrcBoxNumber: 1 },
  { name: "Standard Rate Input", rate: 20, taxType: "INPUT", isDefault: false, hmrcBoxNumber: 4 },
  { name: "Zero Rated", rate: 0, taxType: "OUTPUT", isDefault: false, hmrcBoxNumber: null },
  { name: "Exempt", rate: 0, taxType: "NONE", isDefault: false, hmrcBoxNumber: null },
] as const;

// ─── Seed Function ───────────────────────────────────────────────────────────

async function main() {
  console.log("Seeding Chart of Accounts...");

  for (const acct of accounts) {
    await prisma.chartOfAccount.upsert({
      where: { accountCode: acct.accountCode },
      update: {
        accountName: acct.accountName,
        accountType: acct.accountType,
        accountSubType: acct.accountSubType,
      },
      create: {
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        accountType: acct.accountType,
        accountSubType: acct.accountSubType,
        isSystemAccount: true,
      },
    });
    console.log(`  Account ${acct.accountCode} — ${acct.accountName}`);
  }

  console.log("\nSeeding Tax Rates...");

  for (const tr of taxRates) {
    await prisma.taxRate.upsert({
      where: { id: `tax-${tr.name.toLowerCase().replace(/\s+/g, "-")}` },
      update: {
        name: tr.name,
        rate: tr.rate,
        taxType: tr.taxType,
        isDefault: tr.isDefault,
        hmrcBoxNumber: tr.hmrcBoxNumber,
      },
      create: {
        id: `tax-${tr.name.toLowerCase().replace(/\s+/g, "-")}`,
        name: tr.name,
        rate: tr.rate,
        taxType: tr.taxType,
        isDefault: tr.isDefault,
        hmrcBoxNumber: tr.hmrcBoxNumber,
      },
    });
    console.log(`  Tax Rate: ${tr.name} (${tr.rate}%) — ${tr.taxType}`);
  }

  console.log("\nSeeding Barclays Bank Account...");

  // Get the Barclays COA record
  const barclaysCoa = await prisma.chartOfAccount.findUnique({
    where: { accountCode: "1000" },
  });

  if (!barclaysCoa) {
    throw new Error("Barclays COA account (1000) not found — this should not happen after seeding.");
  }

  await prisma.bankAccount.upsert({
    where: { accountId: barclaysCoa.id },
    update: {
      bankName: "Barclays Bank PLC",
      accountName: "Cromwell Plumbing Ltd",
      sortCode: "20-45-45",
      accountNumber: "93602001",
    },
    create: {
      accountId: barclaysCoa.id,
      bankName: "Barclays Bank PLC",
      accountName: "Cromwell Plumbing Ltd",
      sortCode: "20-45-45",
      accountNumber: "93602001",
      currency: "GBP",
      isDefault: true,
    },
  });
  console.log("  Barclays Bank PLC — 20-45-45 / 93602001");

  console.log("\nSeed complete.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

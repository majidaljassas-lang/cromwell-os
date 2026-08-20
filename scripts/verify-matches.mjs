#!/usr/bin/env node

/**
 * VERIFY ACTUAL MATCHES — Show what was really matched
 * Not just scoring, but the actual transaction data
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function verifyMatches() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════╗");
  console.log("║        VERIFICATION: ACTUAL MATCHES WITH FULL DATA            ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝");

  // Get all October invoices
  const bills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: new Date("2025-10-01"), lt: new Date("2025-11-01") } },
    include: { supplier: { select: { name: true } }, lines: { select: { description: true, lineTotal: true } } }
  });

  const bankLines = await prisma.bankLine.findMany();

  const bankLinesNorm = bankLines.map(bl => ({
    id: bl.id,
    txnDate: bl.txnDate,
    amount: typeof bl.amount === 'string' ? parseFloat(bl.amount) : bl.amount,
    memo: bl.memo || '',
    account: bl.account
  }));

  console.log(`\n📊 OCTOBER INVOICES IN DATABASE: ${bills.length}`);
  console.log("─".repeat(65));

  // Show all October invoices with their details
  const invoices = [];
  for (const bill of bills) {
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    invoices.push({
      billNo: bill.billNo,
      supplier: bill.supplier.name,
      amount: billAmount,
      date: new Date(bill.billDate),
      lines: bill.lines.length
    });
  }

  // Sort by amount
  invoices.sort((a, b) => b.amount - a.amount);

  invoices.forEach((inv, i) => {
    console.log(`${i + 1}. ${inv.billNo.padEnd(20)} | £${inv.amount.toFixed(2).padStart(10)} | ${inv.date.toISOString().split('T')[0]} | ${inv.supplier} (${inv.lines} lines)`);
  });

  console.log("\n" + "─".repeat(65));
  console.log("\n🔍 CHECKING FOR DUPLICATES:\n");

  // Check for duplicate bill numbers
  const billNos = bills.map(b => b.billNo);
  const duplicates = billNos.filter((x, i) => billNos.indexOf(x) !== i);

  if (duplicates.length > 0) {
    console.log(`⚠️  DUPLICATES FOUND: ${duplicates.length} bill numbers appear multiple times!`);
    duplicates.forEach(dup => {
      const count = billNos.filter(x => x === dup).length;
      console.log(`   - ${dup}: appears ${count} times`);
    });
  } else {
    console.log("✅ No duplicates - each bill number unique");
  }

  console.log("\n" + "─".repeat(65));
  console.log("\n📈 BANK TRANSACTIONS IN OCTOBER:\n");

  const octBankLines = bankLinesNorm.filter(bl => bl.txnDate.getFullYear() === 2025 && bl.txnDate.getMonth() === 9);
  console.log(`Total October transactions: ${octBankLines.length}`);
  console.log(`Total October value: £${octBankLines.reduce((sum, bl) => sum + Math.abs(bl.amount), 0).toFixed(2)}`);

  // Show a sample
  console.log(`\nSample October transactions (first 10):`);
  octBankLines.slice(0, 10).forEach(bl => {
    console.log(`  ${bl.txnDate.toISOString().split('T')[0]} | £${Math.abs(bl.amount).toFixed(2).padStart(10)} | ${bl.memo.substring(0, 40)}`);
  });

  console.log("\n" + "─".repeat(65));
  console.log("\n🎯 DETAILED MATCH INSPECTION (First 5 Invoices):\n");

  // For each invoice, show what it SHOULD match to and what it DID match to
  const AMOUNT_VARIANCE = 0.05;
  const DATE_WINDOW_DAYS = 60;

  for (let i = 0; i < Math.min(5, bills.length); i++) {
    const bill = bills[i];
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    const billDate = new Date(bill.billDate);

    console.log(`\n📋 ${bill.billNo} — £${billAmount.toFixed(2)} on ${billDate.toISOString().split('T')[0]}`);
    console.log(`   Supplier: ${bill.supplier.name}`);

    // Find ALL reasonable candidates
    const candidates = [];
    for (const bankLine of bankLinesNorm) {
      const bankAmount = Math.abs(bankLine.amount);
      const amountDiff = Math.abs(bankAmount - billAmount);
      const amountVariance = amountDiff / billAmount;
      const daysDiff = Math.abs((bankLine.txnDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));

      // More lenient - show anything close
      if (amountVariance <= 0.10 && daysDiff <= 90) {
        const isSameMonth = bankLine.txnDate.getFullYear() === billDate.getFullYear() &&
                           bankLine.txnDate.getMonth() === billDate.getMonth();
        const isNextMonth = bankLine.txnDate.getTime() > billDate.getTime() && daysDiff <= 31;

        candidates.push({
          date: bankLine.txnDate,
          amount: bankAmount,
          memo: bankLine.memo,
          variance: amountVariance,
          daysDiff,
          isSameMonth,
          isNextMonth
        });
      }
    }

    candidates.sort((a, b) => {
      // Sort by: exact match first, then variance, then date
      const aScore = a.variance === 0 ? 0 : a.variance;
      const bScore = b.variance === 0 ? 0 : b.variance;
      return aScore - bScore || a.daysDiff - b.daysDiff;
    });

    if (candidates.length === 0) {
      console.log(`   ❌ NO candidates found (even with loose criteria)`);
    } else if (candidates.length === 1) {
      const c = candidates[0];
      console.log(`   ✅ ONE candidate: £${c.amount.toFixed(2)} on ${c.date.toISOString().split('T')[0]} (${c.daysDiff.toFixed(0)}d gap, ${(c.variance*100).toFixed(1)}% variance)`);
      console.log(`      Memo: "${c.memo}"`);
    } else {
      console.log(`   ⚠️  ${candidates.length} candidates found:`);
      candidates.slice(0, 3).forEach((c, idx) => {
        const quality = c.variance === 0 && c.isSameMonth ? "🔴 PERFECT" :
                       c.variance < 0.02 && (c.isSameMonth || c.isNextMonth) ? "🟡 GOOD" : "🟠 OK";
        console.log(`      ${idx + 1}. ${quality} — £${c.amount.toFixed(2)} on ${c.date.toISOString().split('T')[0]} (${c.daysDiff.toFixed(0)}d, ${(c.variance*100).toFixed(1)}% var)`);
        console.log(`         "${c.memo.substring(0, 50)}"`);
      });
    }
  }

  console.log("\n" + "═".repeat(65));
  console.log("\n⚠️  POTENTIAL ISSUES TO CHECK:\n");
  console.log("1. Are there multiple invoices for the same supplier on same date?");
  console.log("2. Are small invoices matching to the wrong transaction?");
  console.log("3. Are there invoices with NO good candidates?");
  console.log("4. Are there duplicate invoice numbers from different suppliers?");
  console.log("5. Did the extraction create any malformed data?");

  await prisma.$disconnect();
}

verifyMatches().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

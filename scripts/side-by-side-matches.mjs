#!/usr/bin/env node

/**
 * SIDE-BY-SIDE VERIFICATION
 * Show invoice + matched bank transaction together for inspection
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function sideBySide() {
  console.log("\n");
  console.log("╔═══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                   SIDE-BY-SIDE INVOICE ↔ BANK TRANSACTION                      ║");
  console.log("║              Can you verify if these ACTUALLY belong together?                ║");
  console.log("╚═══════════════════════════════════════════════════════════════════════════════╝");

  const bills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: new Date("2025-10-01"), lt: new Date("2025-11-01") } },
    include: { supplier: { select: { name: true } }, lines: true }
  });

  const bankLines = await prisma.bankLine.findMany();

  const bankLinesNorm = bankLines.map(bl => ({
    id: bl.id,
    txnDate: bl.txnDate,
    amount: typeof bl.amount === 'string' ? parseFloat(bl.amount) : bl.amount,
    memo: bl.memo || '',
    account: bl.account
  }));

  // Deduplicate by billNo (keep first occurrence only)
  const seen = new Set();
  const uniqueBills = [];
  for (const bill of bills) {
    if (!seen.has(bill.billNo)) {
      seen.add(bill.billNo);
      uniqueBills.push(bill);
    }
  }

  console.log(`\n📋 INVOICES: ${uniqueBills.length} unique (deduplicated from ${bills.length})\n`);

  const AMOUNT_VARIANCE = 0.05;
  const DATE_WINDOW_DAYS = 60;

  // Sort by amount descending
  uniqueBills.sort((a, b) => (parseFloat(b.amountIncVat || b.totalCost) - parseFloat(a.amountIncVat || a.totalCost)));

  for (let i = 0; i < uniqueBills.length; i++) {
    const bill = uniqueBills[i];
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    const billDate = new Date(bill.billDate);
    const supplierName = bill.supplier.name.toLowerCase();

    // Find best match
    const candidates = [];
    for (const bankLine of bankLinesNorm) {
      const bankAmount = Math.abs(bankLine.amount);
      const amountDiff = Math.abs(bankAmount - billAmount);
      const amountVariance = amountDiff / billAmount;
      const daysDiff = Math.abs((bankLine.txnDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));

      let score = 0;

      if (amountVariance <= AMOUNT_VARIANCE) {
        score += 100 - amountVariance * 1000;
      }

      if (daysDiff <= DATE_WINDOW_DAYS) {
        score += 50 - (daysDiff / DATE_WINDOW_DAYS) * 50;
      }

      const monthDiff = Math.abs(
        billDate.getFullYear() * 12 + billDate.getMonth() -
        (bankLine.txnDate.getFullYear() * 12 + bankLine.txnDate.getMonth())
      );
      if (monthDiff === 0 || monthDiff === 1) score += 50;
      else if (monthDiff > 6) score -= 30;

      if (bankLine.memo.toLowerCase().includes(supplierName)) {
        score += 30;
      }

      if (score > 60) {
        candidates.push({
          ...bankLine,
          score,
          daysDiff,
          amountVariance
        });
      }
    }

    if (candidates.length === 0) {
      console.log(`\n❌ ${i + 1}. INVOICE ${bill.billNo}`);
      console.log(`   SUPPLIER:     ${bill.supplier.name}`);
      console.log(`   AMOUNT:       £${billAmount.toFixed(2)}`);
      console.log(`   DATE:         ${billDate.toISOString().split('T')[0]}`);
      console.log(`   LINES:        ${bill.lines.map(l => `"${l.description.substring(0, 30)}..."`).join(', ')}`);
      console.log(`   ⚠️  NO BANK MATCH FOUND (even with 60-day window)`);
      continue;
    }

    candidates.sort((a, b) => b.score - a.score);
    const bestMatch = candidates[0];

    const matchQuality =
      bestMatch.amountVariance === 0 && bestMatch.daysDiff <= 10 ? "🟢 EXCELLENT" :
      bestMatch.amountVariance <= 0.01 && bestMatch.daysDiff <= 20 ? "🟢 VERY GOOD" :
      bestMatch.amountVariance <= 0.03 && bestMatch.daysDiff <= 30 ? "🟡 GOOD" :
      bestMatch.amountVariance <= 0.05 && bestMatch.daysDiff <= 40 ? "🟠 OK" : "🔴 QUESTIONABLE";

    console.log(`\n${matchQuality} ${i + 1}. INVOICE ${bill.billNo}`);
    console.log(`   ┌─ INVOICE SIDE ─────────────────────────────────┐  ┌─ BANK TRANSACTION SIDE ─────────────────────┐`);
    console.log(`   │ Supplier: ${bill.supplier.name.padEnd(42)} │  │ Date: ${bestMatch.txnDate.toISOString().split('T')[0]} ${' '.repeat(33)} │`);
    console.log(`   │ Amount: £${billAmount.toFixed(2).padEnd(46)} │  │ Amount: £${Math.abs(bestMatch.amount).toFixed(2)} ${' '.repeat(36)} │`);
    console.log(`   │ Date: ${billDate.toISOString().split('T')[0]} ${' '.repeat(43)} │  │ Memo: ${bestMatch.memo.substring(0, 43)} ${' '.repeat(Math.max(0, 43 - bestMatch.memo.substring(0, 43).length))} │`);
    console.log(`   │ Invoice #: ${bill.billNo.padEnd(36)} │  │ Match Quality: ${matchQuality.substring(1).padEnd(24)} │`);
    console.log(`   │ Lines: ${bill.lines.length} items ${' '.repeat(34)} │  │ Gap: ${bestMatch.daysDiff.toFixed(0)} days, ${(bestMatch.amountVariance*100).toFixed(1)}% var  ${' '.repeat(22)} │`);

    if (bill.lines.length > 0) {
      const line = bill.lines[0];
      console.log(`   │ First item: "${line.description.substring(0, 30)}${line.description.length > 30 ? '...' : ''}"${' '.repeat(Math.max(0, 9 - (line.description.substring(0, 30).length + 3)))} │  │ Account: ${bestMatch.account.padEnd(32)} │`);
    }

    console.log(`   └─────────────────────────────────────────────────┘  └─────────────────────────────────────────────┘`);

    if (candidates.length > 1) {
      console.log(`   ⚠️  Also had ${candidates.length - 1} other candidates (showing best match above)`);
    }
  }

  console.log("\n" + "═".repeat(90));
  console.log("\n✅ INSTRUCTIONS FOR VERIFICATION:\n");
  console.log("1. Look at each INVOICE row on the left");
  console.log("2. Look at the matched BANK TRANSACTION on the right");
  console.log("3. Ask yourself: Does this £XX invoice get paid by this £YY bank transaction on this date?");
  console.log("4. Check the color coding:");
  console.log("   🟢 GREEN = Amount exact + date close + likely match");
  console.log("   🟡 YELLOW = Amount close + reasonable date gap");
  console.log("   🟠 ORANGE = Amount within tolerance but date gap is large");
  console.log("   🔴 RED = Amount/date combination seems wrong");
  console.log("\n5. If you see 🔴 RED matches, those are FALSE POSITIVES - stop and flag them");
  console.log("6. If all are 🟢/🟡/🟠, the matching is sound\n");

  await prisma.$disconnect();
}

sideBySide().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

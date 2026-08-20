#!/usr/bin/env node

/**
 * Analyze match quality and identify issues
 * Shows why some matches are problematic
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function analyzeQuality() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║              MATCH QUALITY ANALYSIS — Diagnostic Report             ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const bills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: new Date("2025-10-01"), lt: new Date("2025-11-01") } },
    include: { supplier: { select: { name: true } } }
  });

  const bankLines = await prisma.bankLine.findMany();

  const bankLinesNorm = bankLines.map(bl => ({
    id: bl.id,
    txnDate: bl.txnDate,
    amount: typeof bl.amount === 'string' ? parseFloat(bl.amount) : bl.amount,
    memo: bl.memo || '',
    account: bl.account
  }));

  console.log("\n🔍 ISSUE IDENTIFIED:\n");
  console.log("The matching algorithm is finding high-scoring candidates from");
  console.log("HISTORICAL transactions (2019-2024) instead of OCTOBER 2025.\n");
  console.log("Example: £16.49 Toolstation bill (Oct 5, 2025) matched to");
  console.log("         £16.16 transaction from Dec 14, 2021 (4 YEARS OLD!)\n");
  console.log("Why this happened:");
  console.log("  1. Amount matches very closely (98% match = high score)");
  console.log("  2. Supplier name in memo = 30-point bonus");
  console.log("  3. Date gap of 1799 days gets 0 points (exceeds 60-day window)");
  console.log("  4. But 81 + 30 = 111 still beats other candidates");
  console.log("  5. The algorithm lacks a TEMPORAL PRIORITY bias\n");

  console.log("─".repeat(70));
  console.log("\n📊 DETAILED MATCH ANALYSIS:\n");

  for (let i = 0; i < bills.length && i < 3; i++) {
    const bill = bills[i];
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    const billDate = new Date(bill.billDate);

    console.log(`BILL: ${bill.billNo} (${bill.supplier.name}) — £${billAmount.toFixed(2)} on ${billDate.toISOString().split('T')[0]}`);

    // Find all candidates
    const candidates = [];
    for (const bankLine of bankLinesNorm) {
      const bankAmount = Math.abs(bankLine.amount);
      const amountDiff = Math.abs(bankAmount - billAmount);
      const amountVariance = amountDiff / billAmount;
      const daysDiff = Math.abs((bankLine.txnDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));

      let score = 0;
      let breakdown = { amount: 0, date: 0, memo: 0 };

      if (amountVariance <= 0.05) {
        breakdown.amount = 100 - amountVariance * 1000;
        score += breakdown.amount;
      }

      if (daysDiff <= 60) {
        breakdown.date = 50 - (daysDiff / 60) * 50;
        score += breakdown.date;
      }

      if (bankLine.memo.toLowerCase().includes(bill.supplier.name.toLowerCase())) {
        breakdown.memo = 30;
        score += breakdown.memo;
      }

      if (score > 60) {
        candidates.push({
          amount: bankAmount,
          date: bankLine.txnDate,
          memo: bankLine.memo,
          score,
          daysDiff,
          breakdown,
          isOct2025: bankLine.txnDate.getFullYear() === 2025 && bankLine.txnDate.getMonth() === 9
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    console.log(`  Candidates found: ${candidates.length}`);
    console.log(`  Top match: £${candidates[0].amount.toFixed(2)} on ${candidates[0].date.toISOString().split('T')[0]} (score: ${candidates[0].score.toFixed(1)})`);
    console.log(`             memo: "${candidates[0].memo}"`);
    console.log(`             days gap: ${candidates[0].daysDiff.toFixed(0)} days`);
    console.log(`             breakdown: amount(${candidates[0].breakdown.amount.toFixed(0)}) + date(${candidates[0].breakdown.date.toFixed(0)}) + memo(${candidates[0].breakdown.memo.toFixed(0)})`);

    // Find best OCTOBER match
    const octoberCandidates = candidates.filter(c => c.isOct2025);
    if (octoberCandidates.length > 0) {
      console.log(`\n  ⚠️  BETTER MATCH (October 2025):`);
      console.log(`     £${octoberCandidates[0].amount.toFixed(2)} on ${octoberCandidates[0].date.toISOString().split('T')[0]} (score: ${octoberCandidates[0].score.toFixed(1)})`);
      console.log(`     memo: "${octoberCandidates[0].memo}"`);
      console.log(`     days gap: ${octoberCandidates[0].daysDiff.toFixed(0)} days`);
    } else {
      console.log(`\n  ❌ NO October 2025 match found`);
      console.log(`  Closest Oct 2025 by amount:`);
      const octCandidates = [];
      for (const bankLine of bankLinesNorm) {
        if (bankLine.txnDate.getFullYear() === 2025 && bankLine.txnDate.getMonth() === 9) {
          const bankAmount = Math.abs(bankLine.amount);
          const amountDiff = Math.abs(bankAmount - billAmount);
          const amountVariance = amountDiff / billAmount;
          if (amountVariance <= 0.10) { // 10% window for this search
            octCandidates.push({
              amount: bankAmount,
              date: bankLine.txnDate,
              memo: bankLine.memo,
              variance: amountVariance
            });
          }
        }
      }
      if (octCandidates.length > 0) {
        octCandidates.sort((a, b) => a.variance - b.variance);
        console.log(`     £${octCandidates[0].amount.toFixed(2)} on ${octCandidates[0].date.toISOString().split('T')[0]} (${(octCandidates[0].variance * 100).toFixed(1)}% variance)`);
        console.log(`     memo: "${octCandidates[0].memo}"`);
      }
    }

    console.log();
  }

  console.log("─".repeat(70));
  console.log("\n🔧 RECOMMENDED FIX:\n");
  console.log("Add a TEMPORAL BIAS to prioritize same-period transactions.\n");
  console.log("Enhanced scoring algorithm:");
  console.log("  • Amount match: 0-100 points (as before)");
  console.log("  • Date match: 0-50 points (as before)");
  console.log("  • TEMPORAL BIAS: +50 points if within 30 days (same payment period)");
  console.log("              +20 points if within 90 days (extended terms)");
  console.log("               -30 points if >180 days away (historical, penalize)\n");
  console.log("This ensures October 2025 invoices match October 2025 bank transactions,");
  console.log("while still allowing 30-60 day payment delays.\n");

  console.log("📝 EXPECTED IMPACT:");
  console.log("  Current: Bills match ANY historical transaction with similar amount");
  console.log("  Fixed:   Bills match Oct 2025 transactions that cleared in Oct/Nov/Dec\n");

  await prisma.$disconnect();
}

analyzeQuality().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

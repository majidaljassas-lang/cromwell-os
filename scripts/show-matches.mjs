#!/usr/bin/env node

/**
 * Visualize actual bill-to-bank-line matches with detailed scoring
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const AMOUNT_VARIANCE = 0.05; // 5%
const DATE_WINDOW_DAYS = 60;

async function showMatches() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║           DETAILED MATCH VISUALIZATION — How Transactions Matched    ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const bills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: new Date("2025-10-01"), lt: new Date("2025-11-01") } },
    include: { supplier: { select: { name: true } } }
  });

  const bankLines = await prisma.bankLine.findMany({
    select: {
      id: true,
      txnDate: true,
      amount: true,
      memo: true,
      account: true
    }
  });

  // Convert decimals to numbers
  const bankLinesNorm = bankLines.map(bl => ({
    id: bl.id,
    txnDate: bl.txnDate,
    amount: typeof bl.amount === 'string' ? parseFloat(bl.amount) : bl.amount,
    memo: bl.memo || '',
    account: bl.account
  }));

  console.log("\n📋 MATCHING ALGORITHM:\n");
  console.log("For each bill, find bank lines where:");
  console.log("  1. Amount matches (±5% variance allowed)");
  console.log("  2. Date within 60 days (payment window)");
  console.log("  3. Supplier name appears in memo (bonus score)\n");
  console.log("Score = amount_match_score (0-100) + date_proximity (0-50) + memo_match (0-30)");
  console.log("Accept score ≥60\n");
  console.log("─".repeat(70));

  for (let i = 0; i < bills.length && i < 5; i++) {
    const bill = bills[i];
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    const supplierName = bill.supplier.name.toLowerCase();
    const billDate = new Date(bill.billDate);

    console.log(`\n📄 BILL #${i + 1}: ${bill.billNo}`);
    console.log(`   Supplier: ${bill.supplier.name}`);
    console.log(`   Amount: £${billAmount.toFixed(2)}`);
    console.log(`   Date: ${billDate.toISOString().split('T')[0]}`);
    console.log(`   Looking for bank lines that match...`);

    const candidates = [];

    for (const bankLine of bankLinesNorm) {
      const bankAmount = Math.abs(bankLine.amount);
      const amountDiff = Math.abs(bankAmount - billAmount);
      const amountVariance = amountDiff / billAmount;
      const daysDiff = Math.abs((bankLine.txnDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));

      let score = 0;
      let scoreBreakdown = [];

      // Amount scoring
      if (amountVariance <= AMOUNT_VARIANCE) {
        const amountScore = (100 - amountVariance * 1000);
        score += amountScore;
        scoreBreakdown.push(`amount: ${amountScore.toFixed(1)}/100 (${((1 - amountVariance) * 100).toFixed(1)}% match)`);
      }

      // Date scoring
      if (daysDiff <= DATE_WINDOW_DAYS) {
        const dateScore = 50 - (daysDiff / DATE_WINDOW_DAYS) * 50;
        score += dateScore;
        scoreBreakdown.push(`date: ${dateScore.toFixed(1)}/50 (${daysDiff.toFixed(0)}d gap)`);
      }

      // Memo scoring
      if (bankLine.memo.toLowerCase().includes(supplierName)) {
        score += 30;
        scoreBreakdown.push(`memo: 30/30 (supplier name matched)`);
      }

      if (score > 60) {
        candidates.push({
          bankLineId: bankLine.id,
          amount: bankAmount,
          date: bankLine.txnDate,
          memo: bankLine.memo,
          score,
          scoreBreakdown: scoreBreakdown.join(", ")
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      console.log(`\n   ✅ MATCH FOUND:`);
      console.log(`      Bank date: ${best.date.toISOString().split('T')[0]}`);
      console.log(`      Bank amount: £${best.amount.toFixed(2)}`);
      console.log(`      Bank memo: "${best.memo}"`);
      console.log(`      Confidence: ${best.score.toFixed(1)}%`);
      console.log(`      Scoring breakdown:`);
      console.log(`        → ${best.scoreBreakdown}`);

      if (candidates.length > 1) {
        console.log(`\n      ⚠️  Note: ${candidates.length} candidate lines scored above threshold`);
        console.log(`      Top 3 candidates (by confidence):`);
        candidates.slice(0, 3).forEach((cand, idx) => {
          console.log(`        ${idx + 1}. £${cand.amount.toFixed(2)} (${cand.date.toISOString().split('T')[0]}) — ${cand.score.toFixed(1)}% — "${cand.memo}"`);
        });
      }
    } else {
      console.log(`\n   ❌ NO MATCH FOUND`);
    }
  }

  console.log(`\n${"─".repeat(70)}`);

  // Summary stats
  console.log(`\n📊 MATCHING SUMMARY:\n`);

  let totalMatched = 0;
  let totalCandidates = 0;

  for (const bill of bills) {
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    const supplierName = bill.supplier.name.toLowerCase();
    const billDate = new Date(bill.billDate);

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

      if (bankLine.memo.toLowerCase().includes(supplierName)) {
        score += 30;
      }

      if (score > 60) {
        candidates.push(score);
      }
    }

    if (candidates.length > 0) {
      totalMatched++;
      totalCandidates += candidates.length;
    }
  }

  console.log(`  • Bills analyzed: ${bills.length}`);
  console.log(`  • Bills matched: ${totalMatched}`);
  console.log(`  • Avg candidates per bill: ${(totalCandidates / Math.max(totalMatched, 1)).toFixed(1)}`);
  console.log(`  • Match rate: ${((totalMatched / bills.length) * 100).toFixed(1)}%`);

  console.log(`\n💡 HOW IT WORKS:\n`);
  console.log(`  The matcher scores each (bill, bank-line) pair on three dimensions:`);
  console.log(`\n  1️⃣  AMOUNT MATCH (up to 100 points)`);
  console.log(`      • Bill: £${bills[0].amountIncVat || bills[0].totalCost}`);
  console.log(`      • Accepts ±5% variance (rounding, fees, currency)`);
  console.log(`      • Score = 100 × (1 - variance%)`);
  console.log(`\n  2️⃣  DATE PROXIMITY (up to 50 points)`);
  console.log(`      • Bills typically paid within 30 days (standard terms)`);
  console.log(`      • 60-day window captures late/early payments`);
  console.log(`      • Score = 50 × (1 - days_gap/60)`);
  console.log(`\n  3️⃣  SUPPLIER NAME MATCH (up to 30 points bonus)`);
  console.log(`      • If memo contains supplier name → auto-bonus`);
  console.log(`      • Many bank memos omit supplier; this is optional`);
  console.log(`      • Examples: "CROSSWATER", "APP WHOLESALE" in memo`);
  console.log(`\n  THRESHOLD: Any pairing with score ≥60 is considered a candidate`);
  console.log(`  Best match = highest score`);
  console.log(`  Multiple candidates = ambiguous (may need review)\n`);

  console.log(`╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║                    HOW EACH BILL WAS MATCHED                        ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

  await prisma.$disconnect();
}

showMatches().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

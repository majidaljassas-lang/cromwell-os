#!/usr/bin/env node

/**
 * Phase 3: Bank-to-Bill Matcher V2
 * FIXED: Added temporal bias to prioritize same-period transactions
 *
 * Enhanced scoring:
 *   - Amount match: 0-100 (close variance = high score)
 *   - Date proximity: 0-50 (within 60-day window)
 *   - TEMPORAL BIAS: ±50 (same period priority; penalize historical)
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const AMOUNT_VARIANCE = 0.05;
const DATE_WINDOW_DAYS = 60;

function getTemporalBonus(billDate, bankDate) {
  const billMonth = billDate.getFullYear() * 12 + billDate.getMonth();
  const bankMonth = bankDate.getFullYear() * 12 + bankDate.getMonth();
  const monthDiff = Math.abs(billMonth - bankMonth);

  // +50: same month or next month (payment period)
  // +20: within 3 months (extended terms)
  // 0: older/future by >3 months
  // -30: >6 months away (penalize historical)

  if (monthDiff === 0) return 50;
  if (monthDiff === 1) return 50;
  if (monthDiff <= 3) return 20;
  if (monthDiff > 6) return -30;
  return 0;
}

async function runMatcherV2() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║        CORRECTED MATCHING — V2 WITH TEMPORAL BIAS                  ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝");

  const bills = await prisma.supplierBill.findMany({
    include: { supplier: { select: { name: true } }, lines: { select: { lineTotal: true } } }
  });

  const bankLines = await prisma.bankLine.findMany({
    select: { id: true, txnDate: true, amount: true, memo: true, account: true }
  });

  const bankLinesNorm = bankLines.map(bl => ({
    id: bl.id,
    txnDate: bl.txnDate,
    amount: typeof bl.amount === 'string' ? parseFloat(bl.amount) : bl.amount,
    memo: bl.memo || '',
    account: bl.account
  }));

  console.log("\n🔧 ALGORITHM V2 SCORING:\n");
  console.log("For each (bill, bank-line) pair, calculate:");
  console.log("  Score = AmountScore + DateScore + TemporalBonus\n");
  console.log("  • AmountScore (0-100): How close amounts match");
  console.log("  • DateScore (0-50):    How close dates are (within 60-day window)");
  console.log("  • TemporalBonus (±50): Priority for same-period transactions\n");
  console.log("    ✓ +50: Same month or next month (likely payment period)");
  console.log("    ✓ +20: Within 3 months (extended terms accepted)");
  console.log("    ✓  0:  Beyond 3 months (no special bonus/penalty)");
  console.log("    ✗ -30: >6 months away (penalize historical matches)\n");
  console.log("Threshold: Score ≥60 is a candidate. Best score wins.\n");
  console.log("─".repeat(70));

  const matches = [];
  const details = [];

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
      let amountScore = 0;
      let dateScore = 0;
      let temporalBonus = 0;

      // Amount scoring
      if (amountVariance <= AMOUNT_VARIANCE) {
        amountScore = 100 - amountVariance * 1000;
        score += amountScore;
      }

      // Date scoring
      if (daysDiff <= DATE_WINDOW_DAYS) {
        dateScore = 50 - (daysDiff / DATE_WINDOW_DAYS) * 50;
        score += dateScore;
      }

      // Temporal bias
      temporalBonus = getTemporalBonus(billDate, bankLine.txnDate);
      score += temporalBonus;

      // Memo bonus (still included)
      let memoBonus = 0;
      if (bankLine.memo.toLowerCase().includes(supplierName)) {
        memoBonus = 30;
        score += memoBonus;
      }

      if (score > 60) {
        candidates.push({
          bankLineId: bankLine.id,
          amount: bankAmount,
          date: bankLine.txnDate,
          memo: bankLine.memo,
          score,
          amountScore,
          dateScore,
          temporalBonus,
          memoBonus,
          daysDiff,
          reasons: []
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      matches.push({
        billNo: bill.billNo,
        supplier: bill.supplier.name,
        billAmount,
        billDate,
        matchedBankLineId: best.bankLineId,
        matchedAmount: best.amount,
        matchedDate: best.date,
        matchedMemo: best.memo,
        confidence: Math.min(100, best.score),
        bestScore: best.score,
        temporalBonus: best.temporalBonus,
        candidateCount: candidates.length
      });

      if (bill.billNo.includes("DVS") || bill.billNo.includes("Ideal") || bill.billNo.includes("180564")) {
        details.push({
          billNo: bill.billNo,
          supplier: bill.supplier.name,
          billDate: billDate.toISOString().split('T')[0],
          billAmount,
          match: {
            date: best.date.toISOString().split('T')[0],
            amount: best.amount,
            memo: best.memo,
            daysDiff: Math.abs((best.date.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24))
          },
          scoring: {
            amount: best.amountScore.toFixed(1),
            date: best.dateScore.toFixed(1),
            temporal: best.temporalBonus,
            memo: best.memoBonus,
            total: best.score.toFixed(1)
          }
        });
      }
    }
  }

  // Show sample matches
  console.log("\n📊 SAMPLE MATCHES (V2 With Temporal Bias):\n");

  details.forEach(detail => {
    console.log(`✅ ${detail.billNo}`);
    console.log(`   Bill date: ${detail.billDate} | Amount: £${detail.billAmount.toFixed(2)}`);
    console.log(`   Matched to: ${detail.match.date} | Amount: £${detail.match.amount.toFixed(2)}`);
    console.log(`   Gap: ${detail.match.daysDiff.toFixed(0)} days | Memo: "${detail.match.memo}"`);
    console.log(`   Score: ${detail.scoring.amount} (amount) + ${detail.scoring.date} (date) + ${detail.scoring.temporal} (temporal) + ${detail.scoring.memo} (memo) = ${detail.scoring.total}`);
    console.log();
  });

  // Statistics
  console.log("─".repeat(70));
  console.log("\n📈 OVERALL RESULTS:\n");
  console.log(`  • Bills analyzed: ${bills.length}`);
  console.log(`  • Bills matched: ${matches.length}`);
  console.log(`  • Match rate: ${((matches.length / bills.length) * 100).toFixed(1)}%`);
  console.log(`  • High-confidence matches (≥90%): ${matches.filter(m => m.confidence >= 90).length}`);

  // Distribution of temporal bonus
  const temporalDist = {};
  matches.forEach(m => {
    const key = m.temporalBonus >= 50 ? "Same-period (+50)" : m.temporalBonus > 0 ? "Extended (+20)" : m.temporalBonus < 0 ? "Historical (-30)" : "No bonus (0)";
    temporalDist[key] = (temporalDist[key] || 0) + 1;
  });

  console.log(`\n🕐 TEMPORAL BIAS DISTRIBUTION:\n`);
  Object.entries(temporalDist).forEach(([key, count]) => {
    console.log(`  • ${key}: ${count} matches`);
  });

  console.log(`\n✨ IMPROVEMENT:\n`);
  console.log(`  V1 (old): Matched bills to ANY historical transaction with similar amount`);
  console.log(`  V2 (new): Prioritizes same-period matches; penalizes >6mo historical`);
  console.log(`  Result:   ${temporalDist["Same-period (+50)"] || 0}/${matches.length} matches are same-period (Oct 2025 bills → Oct 2025 transactions)`);

  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║                    CORRECTED MATCHING COMPLETE                      ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝\n`);

  await prisma.$disconnect();
}

runMatcherV2().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

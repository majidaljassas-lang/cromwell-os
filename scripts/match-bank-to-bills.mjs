#!/usr/bin/env node

/**
 * Phase 3: Bank-to-Bill Matcher
 * Reconciles BankLines (14,314 rows) against SupplierBills
 * Outputs matching report with patterns (single-bill, multi-bill, partial, overpay)
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const AMOUNT_VARIANCE = 0.05; // 5% tolerance for minor fees/rounding
const DATE_WINDOW_DAYS = 60;   // Bills can be paid within 60 days of invoice

async function runMatcher() {
  console.log("📊 Phase 3: Bank-to-Bill Matching");
  console.log("━".repeat(60));

  // Fetch all bills and bank lines
  const bills = await prisma.supplierBill.findMany({
    include: {
      supplier: { select: { name: true } },
      lines: { select: { lineTotal: true, description: true } }
    }
  });

  const bankLines = (await prisma.bankLine.findMany({
    select: {
      id: true,
      txnDate: true,
      amount: true,
      memo: true,
      account: true
    }
  })).map(bl => ({
    id: bl.id,
    txnDate: bl.txnDate,
    amount: typeof bl.amount === 'string' ? parseFloat(bl.amount) : bl.amount,
    memo: bl.memo || '',
    account: bl.account
  }));

  console.log(`\n📋 Input:`);
  console.log(`  • SupplierBills: ${bills.length}`);
  console.log(`  • BankLines: ${bankLines.length}`);
  console.log(`  • Total bill value: £${bills.reduce((sum, b) => sum + parseFloat(b.amountIncVat || 0), 0).toFixed(2)}`);

  const matches = [];
  const unmatched = { bills: [], bankLines: [] };
  const ambiguous = [];

  // For each bill, find matching bank lines
  for (const bill of bills) {
    const billAmount = Math.abs(parseFloat(bill.amountIncVat || bill.totalCost));
    const supplierName = bill.supplier.name.toLowerCase();
    const billDate = new Date(bill.billDate);

    const candidates = [];

    for (const bankLine of bankLines) {
      const bankAmount = Math.abs(bankLine.amount);
      const amountDiff = Math.abs(bankAmount - billAmount);
      const amountVariance = amountDiff / billAmount;
      const daysDiff = Math.abs((bankLine.txnDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));

      // Score: amount match + date proximity + supplier name in memo
      let score = 0;
      let reasons = [];

      if (amountVariance <= AMOUNT_VARIANCE) {
        score += 100 - amountVariance * 1000; // Penalize variance
        reasons.push(`amount (${((1 - amountVariance) * 100).toFixed(1)}% match)`);
      }

      if (daysDiff <= DATE_WINDOW_DAYS) {
        score += 50 - (daysDiff / DATE_WINDOW_DAYS) * 50;
        reasons.push(`date (${daysDiff.toFixed(0)}d gap)`);
      }

      if (bankLine.memo.toLowerCase().includes(supplierName)) {
        score += 30;
        reasons.push(`supplier name matched`);
      }

      if (score > 60) { // Threshold for consideration
        candidates.push({
          bankLineId: bankLine.id,
          amount: bankAmount,
          date: bankLine.txnDate,
          memo: bankLine.memo,
          score,
          reasons: reasons.join(", ")
        });
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      matches.push({
        billId: bill.id,
        billNo: bill.billNo,
        supplier: bill.supplier.name,
        billAmount,
        billDate,
        matchedBankLineId: best.bankLineId,
        matchedAmount: best.amount,
        matchedDate: best.date,
        matchedMemo: best.memo,
        confidence: Math.min(100, best.score),
        pattern: candidates.length > 1 ? "AMBIGUOUS" : "SINGLE_MATCH",
        candidateCount: candidates.length,
        topReason: best.reasons
      });
    } else {
      unmatched.bills.push({
        billNo: bill.billNo,
        supplier: bill.supplier.name,
        amount: billAmount,
        date: billDate
      });
    }
  }

  // Find unmatched bank lines
  const matchedBankLineIds = new Set(matches.map(m => m.matchedBankLineId));
  unmatched.bankLines = bankLines.filter(bl => !matchedBankLineIds.has(bl.id));

  // Generate report
  console.log(`\n✅ MATCHED:`);
  console.log(`  • Bills matched: ${matches.length}/${bills.length}`);
  const matchedValue = matches.reduce((sum, m) => sum + m.billAmount, 0);
  console.log(`  • Value: £${matchedValue.toFixed(2)}`);
  console.log(`  • Avg confidence: ${(matches.reduce((sum, m) => sum + m.confidence, 0) / matches.length).toFixed(0)}%`);

  console.log(`\n❌ UNMATCHED:`);
  console.log(`  • Bills: ${unmatched.bills.length}/${bills.length}`);
  const unmatchedBillValue = unmatched.bills.reduce((sum, b) => sum + b.amount, 0);
  console.log(`  • Value: £${unmatchedBillValue.toFixed(2)}`);

  console.log(`\n🏦 BANK LINES:`);
  console.log(`  • Matched: ${matchedBankLineIds.size}/${bankLines.length}`);
  const matchedBankValue = matches.reduce((sum, m) => sum + m.matchedAmount, 0);
  console.log(`  • Value: £${matchedBankValue.toFixed(2)}`);
  console.log(`  • Unmatched: ${unmatched.bankLines.length}/${bankLines.length}`);
  const unmatchedBankValue = unmatched.bankLines.reduce((sum, bl) => sum + Math.abs(bl.amount), 0);
  console.log(`  • Value: £${unmatchedBankValue.toFixed(2)}`);

  // Pattern analysis
  const patterns = {
    SINGLE_MATCH: matches.filter(m => m.pattern === "SINGLE_MATCH").length,
    AMBIGUOUS: matches.filter(m => m.pattern === "AMBIGUOUS").length
  };

  console.log(`\n🔗 MATCH PATTERNS:`);
  console.log(`  • Single match: ${patterns.SINGLE_MATCH}`);
  console.log(`  • Ambiguous (multi-candidate): ${patterns.AMBIGUOUS}`);

  // Sample unmatched bills
  if (unmatched.bills.length > 0) {
    console.log(`\n⚠️  Sample unmatched bills (first 5):`);
    unmatched.bills.slice(0, 5).forEach(b => {
      console.log(`  - ${b.billNo} (${b.supplier}): £${b.amount.toFixed(2)} on ${b.date.toISOString().split('T')[0]}`);
    });
  }

  // Sample unmatched bank lines
  if (unmatched.bankLines.length > 0) {
    console.log(`\n⚠️  Sample unmatched bank lines (first 5):`);
    unmatched.bankLines.slice(0, 5).forEach(bl => {
      const dateStr = bl.txnDate ? bl.txnDate.toISOString().split('T')[0] : 'UNKNOWN';
      console.log(`  - ${dateStr}: £${Math.abs(bl.amount).toFixed(2)} — ${bl.memo}`);
    });
  }

  // High-confidence matches
  const highConfidence = matches.filter(m => m.confidence >= 90);
  console.log(`\n🎯 High-confidence matches (≥90%): ${highConfidence.length}`);

  console.log(`\n━`.repeat(60));
  console.log("✨ Phase 3 complete. Ready for review.");

  await prisma.$disconnect();
}

runMatcher().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});

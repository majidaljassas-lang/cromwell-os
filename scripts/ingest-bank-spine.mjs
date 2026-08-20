#!/usr/bin/env node

/**
 * Ingest CP Bank Spine CSVs into Postgres
 * Reads: data/bank-statements/current-account/current_account_spine_2017-2026.csv
 *        data/bank-statements/credit-card/card_spine_2023-2026.csv
 * Writes: BankLine table (idempotent, upsert by rowHash)
 * Filters: Conservative approach — only certain categories (Debit, Bill Payment, Credit, PURCHASE)
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
// File paths
const CURRENT_ACCT_CSV = path.resolve("data/bank-statements/current-account/current_account_spine_2017-2026.csv");
const CARD_CSV = path.resolve("data/bank-statements/credit-card/card_spine_2023-2026.csv");

// Expected locked figures for verification
const EXPECTED_CURRENT_SUM = 197057.85;
const EXPECTED_CURRENT_COUNT = 11056;
const EXPECTED_CARD_SUM = -2839873.26 + 2817320.38; // purchases out + payments in = net
const EXPECTED_CARD_COUNT = 3260;

// NOTE: Phase 1 ingests ALL bank lines unfiltered. Exclusion rules (non-purchase categorization)
// are applied during Phase 3 matching, where business context can inform the decision.
// See plan: "Option A (conservative)" means Phase 3 will start with certain types, let remainder flow to exceptions.

function hashRow(account, txnDate, amount, memo, sourceRow) {
  const str = `${account}|${txnDate}|${amount}|${memo}|${sourceRow}`;
  return crypto.createHash("sha256").update(str).digest("hex");
}

function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, "utf-8").split("\n");
  const results = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;

    const cols = lines[i].split(",");
    if (cols.length < 6) continue;

    results.push({
      spineNumber: cols[0]?.trim() || null,
      txnDate: cols[1]?.trim(),
      account: cols[2]?.trim(),
      amount: parseFloat(cols[3]),
      subcategory: cols[4]?.trim() || null,
      memo: cols[5]?.trim(),
      sourceRow: i, // 1-based row number (header is row 1, first data is row 2, etc.)
    });
  }

  return results;
}

async function ingestCurrentAccount() {
  console.log("Reading current account CSV...");
  const rows = parseCSV(CURRENT_ACCT_CSV);
  console.log(`  Total rows in CSV: ${rows.length}`);

  // No filter - ingest all rows unfiltered
  // Exclusion rules applied in Phase 3 (matching), not here

  let sumAmount = 0;
  const bankLines = [];

  for (const row of rows) {
    sumAmount += row.amount;
    const rowHash = hashRow("CURRENT", row.txnDate, row.amount, row.memo, row.sourceRow);

    bankLines.push({
      id: `bl_${crypto.randomUUID().slice(0, 8)}`,
      account: "CURRENT",
      spineNumber: row.spineNumber,
      txnDate: new Date(row.txnDate),
      amount: row.amount,
      subcategory: row.subcategory,
      memo: row.memo,
      sourceRow: row.sourceRow,
      rowHash,
      matchStatus: "UNMATCHED",
    });
  }

  console.log(`  Sum of all current account lines: £${sumAmount.toFixed(2)}`);
  console.log(`  Expected: £${EXPECTED_CURRENT_SUM.toFixed(2)}`);

  if (Math.abs(sumAmount - EXPECTED_CURRENT_SUM) > 0.01) {
    console.error(`  ❌ MISMATCH: current account sum does not tie to locked figure!`);
    return { success: false, count: 0, sum: sumAmount };
  }

  console.log(`  ✓ Sum verified`);

  // Upsert
  console.log(`\nUpserting ${bankLines.length} current account lines...`);
  let upserted = 0;
  for (const line of bankLines) {
    const result = await prisma.bankLine.upsert({
      where: { rowHash: line.rowHash },
      update: {}, // Don't change existing rows, just skip
      create: line,
    });
    if (result) upserted++;
  }

  console.log(`  ✓ Upserted ${upserted} current account lines`);
  return { success: true, count: rows.length, sum: sumAmount };
}

async function ingestCard() {
  console.log("\nReading card CSV...");
  const rows = parseCSV(CARD_CSV);
  console.log(`  Total rows in CSV: ${rows.length}`);

  // No filter - ingest all card rows (PURCHASE, PAYMENT, FEE)
  // Exclusion rules applied in Phase 3 (matching), not here

  let sumAmount = 0;
  const bankLines = [];

  for (const row of rows) {
    sumAmount += row.amount;
    const rowHash = hashRow("CARD", row.txnDate, row.amount, row.memo, row.sourceRow);

    bankLines.push({
      id: `bl_${crypto.randomUUID().slice(0, 8)}`,
      account: "CARD",
      spineNumber: row.spineNumber,
      txnDate: new Date(row.txnDate),
      amount: row.amount,
      subcategory: row.subcategory,
      memo: row.memo,
      sourceRow: row.sourceRow,
      rowHash,
      matchStatus: "UNMATCHED",
    });
  }

  // Card expected sum is the locked figure: -£22,308.40
  // (purchases -£2,839,873.26 + payments +£2,817,320.38 + fees -£244.48 + rounding)
  const expectedCardNetSum = -22308.40;

  console.log(`  Sum of all card rows: £${sumAmount.toFixed(2)}`);
  console.log(`  Expected card net sum: £${expectedCardNetSum.toFixed(2)}`);

  if (Math.abs(sumAmount - expectedCardNetSum) > 0.01) {
    console.error(`  ❌ MISMATCH: card sum does not match!`);
    return { success: false, count: 0, sum: sumAmount };
  }

  console.log(`  ✓ Sum verified`);

  // Upsert
  console.log(`\nUpserting ${bankLines.length} card lines...`);
  let upserted = 0;
  for (const line of bankLines) {
    const result = await prisma.bankLine.upsert({
      where: { rowHash: line.rowHash },
      update: {},
      create: line,
    });
    if (result) upserted++;
  }

  console.log(`  ✓ Upserted ${upserted} card lines`);
  return { success: true, count: rows.length, sum: sumAmount };
}

async function verify() {
  console.log("\n=== Verification ===");

  const currentLines = await prisma.bankLine.count({ where: { account: "CURRENT" } });
  const cardLines = await prisma.bankLine.count({ where: { account: "CARD" } });

  const currentSum = await prisma.bankLine.aggregate({
    where: { account: "CURRENT" },
    _sum: { amount: true },
  });

  const cardSum = await prisma.bankLine.aggregate({
    where: { account: "CARD" },
    _sum: { amount: true },
  });

  console.log(`Current account: ${currentLines} lines, sum £${(currentSum._sum.amount || 0).toFixed(2)}`);
  console.log(`Card: ${cardLines} lines, sum £${(cardSum._sum.amount || 0).toFixed(2)}`);
  console.log(`Total: ${currentLines + cardLines} lines`);

  let success = true;

  if (Math.abs((currentSum._sum.amount || 0) - EXPECTED_CURRENT_SUM) > 0.01) {
    console.error(`  ❌ Current account sum mismatch`);
    success = false;
  } else {
    console.log(`  ✓ Current account sum verified`);
  }

  // Card expected is the locked figure
  const expectedCardNet = -22308.40;
  if (Math.abs((cardSum._sum.amount || 0) - expectedCardNet) > 0.01) {
    console.error(`  ❌ Card sum mismatch`);
    success = false;
  } else {
    console.log(`  ✓ Card sum verified`);
  }

  return success;
}

async function main() {
  console.log("=== CP Bank Spine Ingestion (Phase 1) ===\n");

  try {
    const currentResult = await ingestCurrentAccount();
    const cardResult = await ingestCard();

    if (!currentResult.success || !cardResult.success) {
      console.error("\n❌ Ingestion failed verification");
      process.exit(1);
    }

    const verified = await verify();

    if (!verified) {
      console.error("\n❌ Final verification failed");
      process.exit(1);
    }

    console.log("\n✅ Bank spine ingestion complete and verified");
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

#!/usr/bin/env node
/**
 * DRY RUN — dedupe duplicate JournalEntry rows. No writes.
 * Lists every (sourceType, sourceId) group with duplicates and what would
 * be deleted + which COA balances would be reversed.
 */

import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dups = await prisma.$queryRaw`
  SELECT "sourceType", "sourceId", COUNT(*) AS n
  FROM "JournalEntry"
  WHERE "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL
  GROUP BY "sourceType", "sourceId"
  HAVING COUNT(*) > 1
  ORDER BY n DESC
`;
console.log(`══════════════════════════════════════════════════════════════════════`);
console.log(`DRY RUN — ${dups.length} (sourceType, sourceId) groups with duplicate journals`);
console.log(`══════════════════════════════════════════════════════════════════════\n`);

if (dups.length === 0) {
  console.log("No duplicates found. Nothing to do.");
  await prisma.$disconnect();
  await pool.end();
  process.exit(0);
}

// Aggregate proposed COA adjustments by account
const coaAdjustments = new Map(); // accountId → cumulative delta

let totalToDelete = 0;
let totalKeep = 0;

for (const grp of dups) {
  const entries = await prisma.journalEntry.findMany({
    where: { sourceType: grp.sourceType, sourceId: grp.sourceId },
    orderBy: { createdAt: "asc" },
    include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
  });
  const [keep, ...remove] = entries;
  totalKeep++;
  totalToDelete += remove.length;

  // Look up source descriptor
  let descriptor = "";
  if (grp.sourceType === "SUPPLIER_BILL") {
    const bill = await prisma.supplierBill.findUnique({
      where: { id: grp.sourceId },
      select: { billNo: true, totalCost: true, supplier: { select: { name: true } } },
    });
    if (bill) descriptor = `${bill.supplier?.name} ${bill.billNo} £${fmt(bill.totalCost)}`;
  }

  console.log(`${grp.sourceType} / ${grp.sourceId.slice(0,8)}  ${descriptor}`);
  console.log(`  KEEP    ${keep.id.slice(0,8)} (created ${keep.createdAt.toISOString().slice(0,16)})`);
  for (const dup of remove) {
    console.log(`  DELETE  ${dup.id.slice(0,8)} (created ${dup.createdAt.toISOString().slice(0,16)})`);
    for (const line of dup.lines) {
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const delta = debit - credit;
      if (delta !== 0) {
        const cur = coaAdjustments.get(line.accountId) || { code: line.account?.accountCode, name: line.account?.accountName, delta: 0 };
        cur.delta += delta;
        coaAdjustments.set(line.accountId, cur);
      }
    }
  }
  console.log();
}

console.log(`SUMMARY`);
console.log(`──────`);
console.log(`Groups with duplicates:        ${dups.length}`);
console.log(`Journal entries to keep:       ${totalKeep}`);
console.log(`Journal entries to DELETE:     ${totalToDelete}`);

console.log(`\nProposed Chart-of-Account balance reversals (currentBalance -= delta):`);
console.log(`(positive delta = balance was over-inflated; will be decreased)`);
for (const [, info] of coaAdjustments) {
  console.log(`  ${info.code} ${info.name?.padEnd(28)} delta = £${fmt(info.delta).padStart(12)}`);
}

await prisma.$disconnect();
await pool.end();

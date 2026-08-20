#!/usr/bin/env node
/**
 * Dedupe duplicate JournalEntry rows that the legacy bill-processor created.
 *
 * Strategy: for each (sourceType, sourceId) with N>1 rows, keep the EARLIEST
 * by createdAt and delete the rest. Reverse the COA balance impact of every
 * deleted JE by decrementing each line's account balance by debit-credit.
 *
 * Run once. After this, the new gl-posting.postSupplierBill path is idempotent
 * so duplicates won't reappear.
 */

import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const dups = await prisma.$queryRaw`
  SELECT "sourceType", "sourceId", COUNT(*) AS n
  FROM "JournalEntry"
  WHERE "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL
  GROUP BY "sourceType", "sourceId"
  HAVING COUNT(*) > 1
  ORDER BY n DESC
`;
console.log(`Found ${dups.length} (sourceType, sourceId) groups with duplicate journals\n`);

let totalDeleted = 0;
let totalCoaAdjustments = 0;

for (const grp of dups) {
  const entries = await prisma.journalEntry.findMany({
    where: { sourceType: grp.sourceType, sourceId: grp.sourceId },
    orderBy: { createdAt: "asc" },
    include: { lines: true },
  });
  // Keep first, delete rest
  const [keep, ...remove] = entries;
  console.log(`  ${grp.sourceType}/${grp.sourceId.slice(0,8)}: keep ${keep.id.slice(0,8)}, delete ${remove.length} dup(s)`);

  for (const dup of remove) {
    // Reverse COA balance impacts by decrementing account currentBalance by (debit - credit)
    for (const line of dup.lines) {
      const debit = Number(line.debit ?? 0);
      const credit = Number(line.credit ?? 0);
      const delta = debit - credit; // positive = inflation to reverse
      if (delta !== 0) {
        await prisma.chartOfAccount.update({
          where: { id: line.accountId },
          data: { currentBalance: { decrement: delta } },
        });
        totalCoaAdjustments++;
      }
    }
    // Delete journal lines first (FK constraint), then the journal entry
    await prisma.journalLine.deleteMany({ where: { journalEntryId: dup.id } });
    await prisma.journalEntry.delete({ where: { id: dup.id } });
    totalDeleted++;
  }
}

console.log(`\nDeleted ${totalDeleted} duplicate journal entries`);
console.log(`Reversed ${totalCoaAdjustments} chart-of-account balance adjustments`);

// Verify
const remaining = await prisma.$queryRaw`
  SELECT "sourceType", "sourceId", COUNT(*) AS n
  FROM "JournalEntry"
  WHERE "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL
  GROUP BY "sourceType", "sourceId"
  HAVING COUNT(*) > 1
`;
console.log(`\nRemaining duplicate groups: ${remaining.length}`);

await prisma.$disconnect();
await pool.end();

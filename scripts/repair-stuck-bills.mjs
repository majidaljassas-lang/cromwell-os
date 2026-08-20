#!/usr/bin/env node
/**
 * Repair the bills inbox stuck queue:
 *  - Boyden 2434457 — re-run processBill so status flips PENDING → POSTED.
 *  - Six zombie bills (0 lines, junk billNo) — delete entirely.
 */

import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Find all SupplierBills with junk billNo (no digit OR < 4 chars OR 0 lines + status=PENDING)
const stuck = await prisma.supplierBill.findMany({
  where: { status: "PENDING" },
  include: { lines: { select: { id: true } } },
});

console.log(`Stuck PENDING bills: ${stuck.length}\n`);

let deleted = 0;
let kept = 0;
for (const b of stuck) {
  const billNo = b.billNo || "";
  const billNoLooksReal = billNo.length >= 4 && /\d/.test(billNo);
  const isZombie = b.lines.length === 0 || !billNoLooksReal;
  if (isZombie) {
    console.log(`  ZOMBIE: "${billNo}" (${b.lines.length} lines, total £${b.totalCost}) — DELETING`);
    // Clean up downstream rows then delete
    const lineIds = b.lines.map(l => l.id);
    if (lineIds.length > 0) {
      await prisma.costAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
      await prisma.absorbedCostAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
      await prisma.billLineAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
    }
    await prisma.supplierBillLine.deleteMany({ where: { supplierBillId: b.id } });
    await prisma.supplierBill.delete({ where: { id: b.id } });
    deleted++;
  } else {
    console.log(`  KEEP: "${billNo}" (${b.lines.length} lines, total £${b.totalCost})`);
    kept++;
  }
}

console.log(`\nDeleted ${deleted} zombies, kept ${kept} real bills.\n`);

// Now re-run processBill on the legitimate ones still PENDING — flips status to POSTED
const remaining = await prisma.supplierBill.findMany({
  where: { status: "PENDING" },
  select: { id: true, billNo: true, supplier: { select: { name: true } } },
});
console.log(`Reprocessing ${remaining.length} legitimate PENDING bills:`);

// Import the processBill function via the dev server's compiled module
// (can't easily call TS code from .mjs script — use the API instead)
const SECRET = process.env.SCHEDULER_SECRET || (await import("node:fs")).readFileSync(".env", "utf-8").match(/SCHEDULER_SECRET=([^\n]+)/)?.[1] || "";

for (const b of remaining) {
  // POST to /api/supplier-bills/[id]/process
  try {
    const res = await fetch(`http://localhost:3000/api/supplier-bills/${b.id}/process`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-scheduler-secret": SECRET },
    });
    const j = await res.json();
    console.log(`  ${b.supplier.name} ${b.billNo} → ${res.ok ? `OK (journal: ${j.journalEntryId ? "created" : "skipped"})` : `FAIL ${j.error}`}`);
  } catch (e) {
    console.log(`  ${b.supplier.name} ${b.billNo} → ERROR ${e.message}`);
  }
}

await prisma.$disconnect();
await pool.end();

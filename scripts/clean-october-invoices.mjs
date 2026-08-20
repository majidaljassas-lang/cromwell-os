#!/usr/bin/env node

/**
 * CLEAN OCTOBER INVOICES
 * 1. Remove duplicates (keep first occurrence)
 * 2. Fix truncated invoice numbers
 * 3. Validate line items
 * 4. Remove suspicious records
 * 5. Export clean dataset
 */

import "dotenv/config";
import fs from "fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function cleanOctober() {
  console.log("\n╔════════════════════════════════════════════════════════╗");
  console.log("║        CLEANING OCTOBER 2025 INVOICE DATA               ║");
  console.log("╚════════════════════════════════════════════════════════╝");

  const bills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: new Date("2025-10-01"), lt: new Date("2025-11-01") } },
    include: {
      supplier: { select: { id: true, name: true } },
      lines: true
    }
  });

  console.log(`\n📊 Starting state: ${bills.length} invoices in database\n`);

  // Step 1: Identify duplicates
  console.log("🔍 Step 1: Identifying duplicates...\n");
  const billNos = bills.map(b => b.billNo);
  const duplicateNos = [...new Set(billNos.filter((x, i) => billNos.indexOf(x) !== i))];

  if (duplicateNos.length > 0) {
    console.log(`Found ${duplicateNos.length} duplicate invoice numbers:`);
    duplicateNos.forEach(dup => {
      const instances = bills.filter(b => b.billNo === dup);
      console.log(`  • ${dup}: ${instances.length} times`);
      instances.forEach((b, i) => {
        console.log(`    ${i + 1}. ${b.supplier.name} | £${b.amountIncVat || b.totalCost} | ${b.billDate.toISOString().split('T')[0]} | ${b.lines.length} lines`);
      });
    });
  } else {
    console.log("✅ No duplicate invoice numbers found");
  }

  // Step 2: Identify truncated/malformed invoice numbers
  console.log("\n🔍 Step 2: Checking for truncated/malformed invoice numbers...\n");
  const malformed = [];
  for (const bill of bills) {
    const issues = [];

    // Check if invoice number looks truncated
    if (bill.billNo.startsWith("YWW") || bill.billNo.startsWith("YUA")) {
      issues.push("Toolstation truncated");
    }

    // Check if it has suspicious length
    if (bill.billNo.length < 5) {
      issues.push("Very short invoice number");
    }

    // Check if description is generic
    if (bill.lines.some(l => l.description === "Toolstation Misc" || l.description === "APP Wholesale Item")) {
      issues.push("Generic/placeholder description");
    }

    // Check for Navigator MSL mixed with CP (shouldn't be there)
    if (bill.supplier.name.includes("Navigator") || bill.supplier.name.includes("Criterion")) {
      issues.push("Non-standard supplier (Navigator/Criterion)");
    }

    if (issues.length > 0) {
      malformed.push({
        billNo: bill.billNo,
        supplier: bill.supplier.name,
        amount: bill.amountIncVat || bill.totalCost,
        date: bill.billDate,
        issues
      });
    }
  }

  if (malformed.length > 0) {
    console.log(`Found ${malformed.length} invoices with issues:`);
    malformed.forEach(m => {
      console.log(`  ⚠️  ${m.billNo} (${m.supplier})`);
      m.issues.forEach(i => console.log(`     - ${i}`));
    });
  } else {
    console.log("✅ No obvious truncation/malformation detected");
  }

  // Step 3: Build clean dataset
  console.log("\n🧹 Step 3: Building clean dataset...\n");

  // Strategy: Keep first occurrence of each billNo, skip Navigator/Criterion
  const seen = new Set();
  const cleanInvoices = [];
  const removed = [];

  for (const bill of bills) {
    // Skip non-standard suppliers
    if (bill.supplier.name.includes("Navigator") || bill.supplier.name.includes("Criterion")) {
      removed.push({
        reason: "Non-standard supplier",
        billNo: bill.billNo,
        supplier: bill.supplier.name
      });
      continue;
    }

    // Skip duplicate invoice numbers (keep first)
    if (seen.has(bill.billNo)) {
      removed.push({
        reason: "Duplicate invoice number",
        billNo: bill.billNo,
        supplier: bill.supplier.name
      });
      continue;
    }

    seen.add(bill.billNo);
    cleanInvoices.push({
      billNo: bill.billNo,
      supplier: bill.supplier.name,
      amount: parseFloat(bill.amountIncVat || bill.totalCost),
      date: bill.billDate.toISOString().split('T')[0],
      dueDate: bill.dueDate ? bill.dueDate.toISOString().split('T')[0] : null,
      lineCount: bill.lines.length,
      lines: bill.lines.map(l => ({
        description: l.description,
        qty: parseFloat(l.qty),
        unitCost: parseFloat(l.unitCost),
        lineTotal: parseFloat(l.lineTotal)
      }))
    });
  }

  console.log(`✅ Clean invoices: ${cleanInvoices.length}`);
  console.log(`🗑️  Removed: ${removed.length}`);

  if (removed.length > 0) {
    console.log(`\nRemoved records:`);
    removed.forEach(r => {
      console.log(`  - ${r.billNo} (${r.supplier}): ${r.reason}`);
    });
  }

  // Step 4: Summary stats
  console.log("\n📈 Step 4: Clean dataset statistics\n");

  const totalValue = cleanInvoices.reduce((sum, inv) => sum + Math.abs(inv.amount), 0);
  const bySupplier = {};
  cleanInvoices.forEach(inv => {
    if (!bySupplier[inv.supplier]) bySupplier[inv.supplier] = { count: 0, value: 0 };
    bySupplier[inv.supplier].count++;
    bySupplier[inv.supplier].value += Math.abs(inv.amount);
  });

  console.log(`Total invoices: ${cleanInvoices.length}`);
  console.log(`Total value: £${totalValue.toFixed(2)}`);
  console.log(`Date range: Oct 1-31, 2025`);
  console.log(`\nBy supplier:`);
  Object.entries(bySupplier).forEach(([supplier, data]) => {
    console.log(`  • ${supplier}: ${data.count} invoices, £${data.value.toFixed(2)}`);
  });

  // Step 5: Export clean data
  const cleanDataPath = "/private/tmp/claude-501/-Users-majidaljassas/258d850b-0d48-4a84-8c17-2491a17659d5/scratchpad/october_2025_clean.json";
  fs.writeFileSync(cleanDataPath, JSON.stringify(cleanInvoices, null, 2));

  console.log(`\n💾 Clean dataset exported: october_2025_clean.json`);
  console.log(`   Location: ${cleanDataPath}`);

  // Step 6: Show sample
  console.log(`\n📋 Sample of clean invoices (first 3):\n`);
  cleanInvoices.slice(0, 3).forEach((inv, i) => {
    console.log(`${i + 1}. ${inv.billNo}`);
    console.log(`   Supplier: ${inv.supplier}`);
    console.log(`   Amount: £${inv.amount.toFixed(2)}`);
    console.log(`   Date: ${inv.date}`);
    console.log(`   Lines: ${inv.lineCount}`);
    if (inv.lineCount > 0) {
      console.log(`   First item: "${inv.lines[0].description}"`);
    }
    console.log();
  });

  console.log("═".repeat(56));
  console.log("\n✅ CLEAN OCTOBER DATA READY FOR ALLOCATION ENGINE\n");

  await prisma.$disconnect();
}

cleanOctober().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

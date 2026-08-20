#!/usr/bin/env node

/**
 * ALLOCATION ENGINE V1
 *
 * Architecture:
 * 1. Load clean invoices (ground truth of what's owed)
 * 2. Load bank transactions (ground truth of what was paid)
 * 3. For each bank transaction, generate allocation hypotheses
 * 4. Score each hypothesis
 * 5. Track allocated/unallocated/partial/overallocated
 */

import "dotenv/config";
import fs from "fs";

// Load clean invoices
const cleanInvoices = JSON.parse(
  fs.readFileSync(
    "/private/tmp/claude-501/-Users-majidaljassas/258d850b-0d48-4a84-8c17-2491a17659d5/scratchpad/october_2025_clean.json",
    "utf8"
  )
);

console.log("\n╔════════════════════════════════════════════════════════╗");
console.log("║        ALLOCATION ENGINE - HYPOTHESIS GENERATION       ║");
console.log("╚════════════════════════════════════════════════════════╝");

console.log(`\n📋 Invoice Register: ${cleanInvoices.length} invoices\n`);

// Group invoices by supplier
const bySupplier = {};
cleanInvoices.forEach(inv => {
  if (!bySupplier[inv.supplier]) bySupplier[inv.supplier] = [];
  bySupplier[inv.supplier].push(inv);
});

console.log("Suppliers and their invoices:");
Object.entries(bySupplier).forEach(([supplier, invoices]) => {
  console.log(`\n${supplier}:`);
  invoices.forEach(inv => {
    console.log(`  • ${inv.billNo} — £${inv.amount.toFixed(2)} (${inv.date})`);
  });
});

console.log("\n" + "═".repeat(56));
console.log("\n🔧 ALLOCATION ENGINE STRATEGY:\n");

console.log("For a bank payment of £1,397.16 from Barco Sales on 6 Jul 2026:");
console.log("(like payment #4672 in the PDF)\n");

console.log("STEP 1: Filter invoices by supplier");
console.log("  → Get all Barco Sales invoices\n");

console.log("STEP 2: Generate candidate combinations");
console.log("  → Find all subsets that sum to £1,397.16");
console.log("  → If Barco has invoices [£213, £1,091, £93]:");
console.log("     - £213 + £1,091 + £93 = £1,397 ✓ MATCH");
console.log("     - £1,091 + £306 = £1,397? (if other invoice exists)");
console.log("     - Just £1,397? (if single invoice)\n");

console.log("STEP 3: Filter by date windows");
console.log("  → Invoice 13 May → Payment 6 Jul = 54 days (acceptable)");
console.log("  → Invoice 28 May → Payment 6 Jul = 39 days (acceptable)");
console.log("  → Invoice 28 Dec (past year) → Payment 6 Jul? (unlikely)\n");

console.log("STEP 4: Score each viable hypothesis");
console.log("  Scoring factors:");
console.log("    • Amount fit (0-100): exact vs. variance");
console.log("    • Temporal fit (0-50): how close dates are");
console.log("    • Supplier fit (0-30): payment memo matches supplier");
console.log("    • Pattern fit (0-20): matches historical payment style\n");

console.log("STEP 5: Return ranked results");
console.log("  Hypothesis 1: [I1057762 + I1059229 + I1059228] = £1,397.16");
console.log("    Confidence: 95% (exact match + temporal fit + supplier match)\n");
console.log("  Hypothesis 2: (none - this was the only viable combination)\n");

console.log("═".repeat(56));

console.log("\n📊 WHAT THE ALLOCATION MUST TRACK:\n");

console.log("For each invoice:");
console.log("  ✓ Allocation status: UNALLOCATED | PARTIAL | ALLOCATED | OVERALLOCATED");
console.log("  ✓ Allocated amount: £X of £Y");
console.log("  ✓ Allocating payment: reference to bank transaction");
console.log("  ✓ Allocation date: when allocated");
console.log("  ✓ Allocation confidence: 95%, 70%, 30%, etc.\n");

console.log("For each bank transaction:");
console.log("  ✓ Allocation status: UNALLOCATED | ALLOCATED | AMBIGUOUS");
console.log("  ✓ Allocated to: which invoices");
console.log("  ✓ Amount allocated: £X of £Y");
console.log("  ✓ Remainder: unallocated balance");
console.log("  ✓ Hypotheses considered: how many valid options were there\n");

console.log("═".repeat(56));

console.log("\n🔨 BUILD PLAN:\n");

console.log("1. Create Allocation table in database");
console.log("   - Tracks which payments settled which invoices");
console.log("   - Tracks partial/full/over allocations");
console.log("   - Audits who made the allocation (system vs. manual)\n");

console.log("2. Create HypothesisGenerator function");
console.log("   - Input: bank transaction + invoice register");
console.log("   - Output: all possible invoice combinations");
console.log("   - Filter by: supplier, date window, amount tolerance\n");

console.log("3. Create AllocatioNScorer function");
console.log("   - Input: hypothesis + context");
console.log("   - Output: confidence score + reasoning");
console.log("   - Factors: amount, date, supplier, pattern\n");

console.log("4. Create AllocationResolver function");
console.log("   - Input: ranked hypotheses");
console.log("   - Output: best allocation OR flag as ambiguous\n");

console.log("5. Run on October data");
console.log("   - Match 14,314 bank lines to 23 invoices");
console.log("   - Track unmatched on both sides");
console.log("   - Report confidence distribution\n");

console.log("═".repeat(56));
console.log("\n✅ READY TO BUILD ALLOCATION ENGINE\n");

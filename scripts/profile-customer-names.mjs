#!/usr/bin/env node
/**
 * Phase 1 — Profile every distinct customer name across:
 *   - ZohoImportedBill.payload->Customer Name (header)
 *   - ZohoImportedBillLine.customerName (line)
 *   - ZohoImportedInvoice.customerName (header)
 *   - Customer.name (live OS)
 *
 * Outputs: each canonical-ish bucket with occurrence count and total £ exposure.
 * Used to seed the customer-cleanup UI.
 */

import "dotenv/config";
import fs from "node:fs";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Normalise for clustering — lowercase, strip punctuation, collapse whitespace,
// drop common suffixes (Ltd / Limited / PLC / LLP) and prefixes ("the ").
function normaliseName(raw) {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[^a-z0-9 &]/g, "")
    .replace(/\b(ltd|limited|plc|llp|llc|inc|incorporated|company)\b/g, "")
    .replace(/^the /, "")
    .trim()
    .replace(/\s+/g, " ");
}

// Token Jaccard for cluster similarity
function tokenSimilarity(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

// Pull occurrences across the four sources
console.log("Loading sources...");

const zohoBills = await prisma.$queryRaw`
  SELECT
    COALESCE(NULLIF(payload->>'Customer Name', ''), '(blank)') AS name,
    COUNT(*) AS occurrences,
    COALESCE(SUM(total::numeric), 0) AS gbp
  FROM "ZohoImportedBill"
  GROUP BY 1
`;

const zohoBillLines = await prisma.$queryRaw`
  SELECT COALESCE(NULLIF("customerName", ''), '(blank)') AS name,
         COUNT(*) AS occurrences,
         COALESCE(SUM("itemTotal"::numeric), 0) AS gbp
  FROM "ZohoImportedBillLine"
  GROUP BY 1
`;

const zohoInvoices = await prisma.$queryRaw`
  SELECT COALESCE(NULLIF("customerName", ''), '(blank)') AS name,
         COUNT(*) AS occurrences,
         COALESCE(SUM(total::numeric), 0) AS gbp
  FROM "ZohoImportedInvoice"
  GROUP BY 1
`;

const liveCustomers = await prisma.$queryRaw`
  SELECT COALESCE(NULLIF(name, ''), '(blank)') AS name,
         1 AS occurrences,
         0 AS gbp
  FROM "Customer"
`;

// Combine into a single bucket map keyed by normalised name
// Each bucket carries the variants seen + cumulative occurrence + cumulative £
const buckets = new Map(); // norm → { variants: Map<raw, count>, totalCount, totalGbp, sources: Set }

function ingest(rows, source) {
  for (const r of rows) {
    const raw = r.name;
    const norm = normaliseName(raw);
    if (!norm) continue;
    let b = buckets.get(norm);
    if (!b) {
      b = { norm, variants: new Map(), totalCount: 0, totalGbp: 0, sources: new Set() };
      buckets.set(norm, b);
    }
    b.variants.set(raw, (b.variants.get(raw) || 0) + Number(r.occurrences));
    b.totalCount += Number(r.occurrences);
    b.totalGbp += Number(r.gbp || 0);
    b.sources.add(source);
  }
}

ingest(zohoBills, "ZohoImportedBill");
ingest(zohoBillLines, "ZohoImportedBillLine");
ingest(zohoInvoices, "ZohoImportedInvoice");
ingest(liveCustomers, "Customer");

const arr = [...buckets.values()].sort((a, b) => b.totalGbp - a.totalGbp);
console.log(`Distinct normalised customer buckets: ${arr.length}`);
console.log(`Total raw variants:                   ${arr.reduce((s, b) => s + b.variants.size, 0)}`);

// Find buckets that themselves have multiple variants (proof of dirty data)
const dirty = arr.filter(b => b.variants.size >= 2);
console.log(`\nBuckets with 2+ raw variants: ${dirty.length}`);
console.log(`(these need merge confirmation)`);

console.log("\n──── Top 20 buckets by £ (top variants flagged) ────");
console.log("  £ TOTAL          OCCURRENCES  VARIANTS  CANONICAL (top variant)");
for (const b of arr.slice(0, 20)) {
  const top = [...b.variants.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "?";
  console.log(`  £${fmt(b.totalGbp).padStart(14)}  ${String(b.totalCount).padStart(11)}  ${String(b.variants.size).padStart(8)}  ${top}`);
}

console.log("\n──── Top 15 dirty buckets (variants > 1, by £) ────");
for (const b of dirty.slice(0, 15)) {
  console.log(`\n  ${b.variants.size} variants · £${fmt(b.totalGbp)} total · ${b.totalCount} rows`);
  const variants = [...b.variants.entries()].sort((x, y) => y[1] - x[1]);
  for (const [raw, n] of variants) {
    console.log(`    [${String(n).padStart(5)}]  ${raw}`);
  }
}

// Cross-bucket clustering: find buckets that *might* belong together via token similarity
// (different normalised forms but share enough tokens to suggest same entity)
console.log("\n──── Cross-bucket suggestion clusters (Jaccard ≥ 0.6) ────");
const seen = new Set();
const clusters = [];
for (let i = 0; i < arr.length; i++) {
  if (seen.has(i)) continue;
  const cluster = [arr[i]];
  seen.add(i);
  for (let j = i + 1; j < arr.length; j++) {
    if (seen.has(j)) continue;
    if (tokenSimilarity(arr[i].norm, arr[j].norm) >= 0.6) {
      cluster.push(arr[j]);
      seen.add(j);
    }
  }
  if (cluster.length >= 2) clusters.push(cluster);
}
console.log(`Found ${clusters.length} cross-bucket clusters needing review.`);
for (const cl of clusters.slice(0, 10)) {
  const totalGbp = cl.reduce((s, b) => s + b.totalGbp, 0);
  console.log(`\n  £${fmt(totalGbp)} total across ${cl.length} normalised forms:`);
  for (const b of cl) {
    const top = [...b.variants.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "?";
    console.log(`    norm="${b.norm}" → ${b.variants.size} variant(s), top: "${top}", £${fmt(b.totalGbp)}`);
  }
}

// Persist the analysis to JSON for the UI to consume
const exportPath = "/tmp/customer-cleanup-profile.json";
fs.writeFileSync(exportPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalBuckets: arr.length,
  totalRawVariants: arr.reduce((s, b) => s + b.variants.size, 0),
  dirtyBuckets: dirty.length,
  buckets: arr.map(b => ({
    norm: b.norm,
    variants: [...b.variants.entries()].map(([raw, count]) => ({ raw, count })),
    totalCount: b.totalCount,
    totalGbp: b.totalGbp,
    sources: [...b.sources],
  })),
  crossClusters: clusters.map(cl => cl.map(b => b.norm)),
}, null, 2));
console.log(`\nFull profile: ${exportPath}`);

await prisma.$disconnect();
await pool.end();

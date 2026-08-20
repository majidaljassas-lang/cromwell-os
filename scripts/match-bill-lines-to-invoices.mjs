#!/usr/bin/env node
/**
 * Cross-reference matcher: ZohoImportedBillLine → ZohoImportedInvoiceLine.
 *
 * Per-line clearance, line-first analysis (header status rolls up from lines).
 *
 * Rules (in priority order):
 *   1. cfSite ∈ {TBC, Multi Site, null, ""} → REVIEW (regardless of other signals).
 *      User must reassign the line to a real site before auto-clearance can run.
 *   2. Look up invoice lines with same normalised cfSite. Within that bucket:
 *      a. customer match + cost match (±5% or ±£1) → CLEARED (conf 95)
 *      b. customer match only                       → SUGGESTED (conf 60)
 *      c. cost match only                           → SUGGESTED (conf 55)
 *      d. site bucket has any candidate             → SUGGESTED (conf 35)
 *   3. No site bucket → NO_MATCH.
 */

import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const REVIEW_SITES = new Set(["", "tbc", "multi site"]);
const COST_TOLERANCE_PCT = 0.05;
const COST_TOLERANCE_ABS = 1.0;

function normSite(s) {
  return (s ?? "").toString().trim().toLowerCase();
}
function normCustomer(s) {
  return (s ?? "").toString().trim().toLowerCase().replace(/\s+ltd$|\s+limited$|\s+plc$/i, "").trim();
}
function costMatches(a, b) {
  if (a == null || b == null) return false;
  const av = Number(a);
  const bv = Number(b);
  if (!Number.isFinite(av) || !Number.isFinite(bv)) return false;
  const absDiff = Math.abs(av - bv);
  if (absDiff <= COST_TOLERANCE_ABS) return true;
  const max = Math.max(Math.abs(av), Math.abs(bv));
  return max > 0 && absDiff / max <= COST_TOLERANCE_PCT;
}

async function main() {
  const startedAt = Date.now();

  console.log("[matcher] loading invoice line index…");
  const invoiceLines = await prisma.zohoImportedInvoiceLine.findMany({
    select: { id: true, cfSite: true, itemTotal: true, invoice: { select: { customerName: true, zohoNumber: true } } },
  });
  console.log(`[matcher] indexed ${invoiceLines.length} invoice lines`);

  // Bucket by normalised cfSite
  const bySite = new Map();
  for (const il of invoiceLines) {
    const site = normSite(il.cfSite);
    if (!site) continue;
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push({
      id: il.id,
      cost: il.itemTotal,
      customer: normCustomer(il.invoice?.customerName),
      invoiceNo: il.invoice?.zohoNumber ?? null,
    });
  }

  console.log(`[matcher] ${bySite.size} distinct cfSite buckets`);

  // Reset all clearance fields first so re-runs are deterministic
  await prisma.$executeRawUnsafe(`
    UPDATE "ZohoImportedBillLine"
    SET "clearStatus"=NULL, "matchedInvoiceLineId"=NULL, "matchConfidence"=NULL,
        "matchReason"=NULL, "matchedAt"=NULL
  `);

  // Stream bill lines in batches to keep memory bounded
  const batchSize = 2000;
  let cursor = null;
  let processed = 0;
  const counts = { CLEARED: 0, SUGGESTED: 0, REVIEW: 0, NO_MATCH: 0 };
  const moneyOnTable = { uncleared_total: 0, uncleared_count: 0 };

  while (true) {
    const lines = await prisma.zohoImportedBillLine.findMany({
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, cfSite: true, itemTotal: true, customerName: true },
    });
    if (lines.length === 0) break;

    const updates = [];
    for (const bl of lines) {
      const site = normSite(bl.cfSite);
      let status = "NO_MATCH";
      let conf = null;
      let reason = "no candidate";
      let matchedId = null;

      if (REVIEW_SITES.has(site)) {
        status = "REVIEW";
        reason = `site '${bl.cfSite ?? "(empty)"}' requires manual assignment`;
      } else {
        const bucket = bySite.get(site);
        if (!bucket || bucket.length === 0) {
          status = "NO_MATCH";
          reason = `no invoice lines tagged site '${bl.cfSite}'`;
        } else {
          const blCust = normCustomer(bl.customerName);
          // Tier a: customer + cost match (single best candidate)
          let best = null;
          for (const il of bucket) {
            const custMatch = blCust && il.customer && blCust === il.customer;
            const costMatch = costMatches(bl.itemTotal, il.cost);
            let tier = null;
            let candConf = 0;
            if (custMatch && costMatch) { tier = "a"; candConf = 95; }
            else if (custMatch)         { tier = "b"; candConf = 60; }
            else if (costMatch)         { tier = "c"; candConf = 55; }
            else                        { tier = "d"; candConf = 35; }
            if (!best || candConf > best.conf) {
              best = { id: il.id, conf: candConf, tier, invoiceNo: il.invoiceNo };
            }
          }
          if (best) {
            matchedId = best.id;
            conf = best.conf;
            if (best.tier === "a") {
              status = "CLEARED";
              reason = `Tier-a: customer + cost match → invoice ${best.invoiceNo}`;
            } else {
              status = "SUGGESTED";
              reason =
                best.tier === "b" ? `Tier-b: customer match → invoice ${best.invoiceNo}` :
                best.tier === "c" ? `Tier-c: cost match → invoice ${best.invoiceNo}` :
                                    `Tier-d: site bucket has ${bucket.length} candidate(s)`;
            }
          }
        }
      }

      counts[status]++;
      if (status !== "CLEARED") {
        const v = Number(bl.itemTotal ?? 0);
        if (Number.isFinite(v)) {
          moneyOnTable.uncleared_total += v;
          moneyOnTable.uncleared_count++;
        }
      }

      updates.push({
        id: bl.id,
        clearStatus: status,
        matchedInvoiceLineId: matchedId,
        matchConfidence: conf,
        matchReason: reason,
      });
    }

    // Persist this batch
    await prisma.$transaction(
      updates.map((u) =>
        prisma.zohoImportedBillLine.update({
          where: { id: u.id },
          data: {
            clearStatus: u.clearStatus,
            matchedInvoiceLineId: u.matchedInvoiceLineId,
            matchConfidence: u.matchConfidence,
            matchReason: u.matchReason,
            matchedAt: new Date(),
          },
        })
      )
    );

    processed += lines.length;
    cursor = lines[lines.length - 1].id;
    console.log(`  processed ${processed}…`);
  }

  const ms = Date.now() - startedAt;
  console.log(`\n[matcher] done in ${(ms / 1000).toFixed(1)}s — processed ${processed} lines`);
  console.log("\n=== CLEARANCE SUMMARY ===");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(7)}  (${((v / processed) * 100).toFixed(1)}%)`);
  }
  console.log(`\n=== MONEY ON THE TABLE ===`);
  console.log(`  uncleared lines: ${moneyOnTable.uncleared_count}`);
  console.log(`  total value:     £${moneyOnTable.uncleared_total.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

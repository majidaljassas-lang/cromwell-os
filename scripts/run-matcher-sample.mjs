#!/usr/bin/env node
/**
 * Generalised invoice ↔ bill line matcher (DRY RUN).
 *
 * Tiers (highest first):
 *   T1 SKU-exact      conf 100 · invoice description has token X (alphanumeric ≥5 chars)
 *                                that appears verbatim on a bill line description in window
 *   T2 Same-job pipe  conf  95 · ≥3 invoice lines match ≥3 bill lines on the SAME bill by
 *                                (size + product class) — Ashworth / single-supplier multi-pipe job
 *   T3 Size+class+qty conf  85 · size + product class + qty within 25% (or MOQ overage)
 *   T4 Size+class     conf  60 · size + product class only
 *   else NO_MATCH
 *
 * No DB writes here — outputs JSON summary and surfaces top recovery targets.
 */

import "dotenv/config";
import fs from "node:fs";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const WINDOW_DAYS = 60;
const SAMPLE_INVOICE_LIMIT = Number(process.argv[2] || 50);

const SKU_RX  = /\b[A-Z]{1,3}\d{3,6}\b|\b[A-Z]+\d{2,}[A-Z]*\b/g; // C0260, K07065, BVAL400090, KPPFMI4211, etc.
const SIZE_RX = /\b(\d{1,3})\s*mm\b/g;

const PRODUCT_CLASSES = [
  { cls: "COPPER_TUBE",   needles: ["copper tube","copper pipe"] },
  { cls: "PRESSFIT",      needles: ["pressfit","press fit","press-fit"] },
  { cls: "PIPE_CUTTER",   needles: ["pipe cutter","tube cutter"] },
  { cls: "BALL_VALVE",    needles: ["ball valve"] },
  { cls: "ELBOW",         needles: ["elbow","bend"] },
  { cls: "TEE",           needles: ["equal tee"," tee "] },
  { cls: "REDUCER",       needles: ["reducer","reducing"] },
  { cls: "COUPLER",       needles: ["coupler","coupling","union"] },
  { cls: "FITTING",       needles: ["fitting","adaptor","adapter"] },
  { cls: "VALVE_OTHER",   needles: ["valve","gate valve","check valve","stop"] },
  { cls: "CLIP_BRACKET",  needles: ["clip","bracket","clamp","band"] },
  { cls: "INSULATION",    needles: ["lagging","insulation","armaflex"] },
  { cls: "SOIL",          needles: ["soil pipe","ensign","agilium"] },
  { cls: "TMV",           needles: ["thermostatic mixing","tmv"] },
];

function classify(desc) {
  const d = (desc || "").toLowerCase();
  for (const p of PRODUCT_CLASSES) if (p.needles.some(n => d.includes(n))) return p.cls;
  return null;
}

function extractSKUs(desc) {
  const out = new Set();
  if (!desc) return out;
  // Use raw (case-preserved) so only uppercase alphanumeric runs are picked up
  for (const m of (desc.match(SKU_RX) || [])) {
    if (m.length >= 4) out.add(m.toUpperCase());
  }
  return out;
}

function extractSizes(desc) {
  const out = new Set();
  if (!desc) return out;
  const lower = desc.toLowerCase();
  let m;
  const rx = /\b(\d{1,3})\s*mm\b/g;
  while ((m = rx.exec(lower)) !== null) out.add(m[1]);
  return out;
}

console.log(`Loading bill lines & invoice lines …`);
const billLines = await prisma.zohoImportedBillLine.findMany({
  include: { bill: { select: { id: true, zohoNumber: true, vendorName: true, billDate: true } } },
});
const invoiceLines = await prisma.zohoImportedInvoiceLine.findMany({
  include: { invoice: { select: { id: true, zohoNumber: true, customerName: true, invoiceDate: true, total: true } } },
});
console.log(`  bills:    ${billLines.length} lines`);
console.log(`  invoices: ${invoiceLines.length} lines\n`);

// Pre-process bill lines: tokens, sizes, classes, SKUs, billDate
const billRecords = billLines.map(bl => {
  const desc = (bl.itemDesc || bl.itemName || "");
  return {
    id: bl.id, billId: bl.billId, billNo: bl.bill.zohoNumber, vendor: bl.bill.vendorName,
    billDate: bl.bill.billDate,
    desc,
    descLower: desc.toLowerCase(),
    skus: extractSKUs(desc),
    sizes: extractSizes(desc),
    cls: classify(desc),
    qty: Number(bl.quantity ?? 0),
    rate: Number(bl.rate ?? 0),
    itemTotal: Number(bl.itemTotal ?? 0),
    cfSite: bl.cfSite,
    customerName: bl.customerName,
  };
});

// Index bill lines by SKU and (cls,size)
const billBySku = new Map();        // sku → [billRecords]
const billBySizeCls = new Map();    // `${size}|${cls}` → [billRecords]
for (const br of billRecords) {
  for (const s of br.skus) {
    if (!billBySku.has(s)) billBySku.set(s, []);
    billBySku.get(s).push(br);
  }
  if (br.cls) {
    for (const sz of br.sizes) {
      const k = `${sz}|${br.cls}`;
      if (!billBySizeCls.has(k)) billBySizeCls.set(k, []);
      billBySizeCls.get(k).push(br);
    }
  }
}

// Group invoice lines by invoice for tier-2 same-job logic
const invByInvoice = new Map();
for (const il of invoiceLines) {
  const key = il.invoice.id;
  if (!invByInvoice.has(key)) invByInvoice.set(key, []);
  invByInvoice.get(key).push(il);
}

// Take a sample (most recent invoices first) for the dry run
const allInvoices = [...invByInvoice.entries()].map(([id, lines]) => ({
  id,
  zohoNumber: lines[0].invoice.zohoNumber,
  customerName: lines[0].invoice.customerName,
  invoiceDate: lines[0].invoice.invoiceDate,
  total: lines[0].invoice.total,
  lines,
}));
allInvoices.sort((a, b) => (b.invoiceDate ?? new Date(0)) - (a.invoiceDate ?? new Date(0)));
const sample = allInvoices.slice(0, SAMPLE_INVOICE_LIMIT);

console.log(`Running DRY matcher on most recent ${sample.length} invoices …\n`);

const summary = {
  invoicesProcessed: 0,
  totalInvoiceLines: 0,
  cleared: 0,
  suggested: 0,
  noMatch: 0,
  clearedValue: 0,
  suggestedValue: 0,
  noMatchValue: 0,
  byTier: { T1: 0, T2: 0, T3: 0, T4: 0 },
};

const perInvoice = [];

for (const inv of sample) {
  let lineSum = { cleared: 0, suggested: 0, noMatch: 0, clearedValue: 0, suggestedValue: 0, noMatchValue: 0 };

  // First pass: detect tier-2 same-job pattern.
  // Find any single bill where ≥3 of this invoice's lines match by (size+cls)
  // within ±WINDOW_DAYS of invoice date
  const invDate = inv.invoiceDate ?? new Date(0);
  const windowLo = new Date(invDate.getTime() - WINDOW_DAYS * 86400000);
  const windowHi = new Date(invDate.getTime() + WINDOW_DAYS * 86400000);

  const billHits = new Map();   // billNo → count of invoice lines hit on that bill
  for (const il of inv.lines) {
    const ilDesc = (il.itemDesc || il.itemName || "");
    const ilCls = classify(ilDesc);
    const ilSizes = extractSizes(ilDesc);
    if (!ilCls) continue;
    for (const sz of ilSizes) {
      const cands = billBySizeCls.get(`${sz}|${ilCls}`) || [];
      for (const c of cands) {
        if (!c.billDate || c.billDate < windowLo || c.billDate > windowHi) continue;
        billHits.set(c.billNo, (billHits.get(c.billNo) || 0) + 1);
      }
    }
  }
  const sameJobBill = [...billHits.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  for (const il of inv.lines) {
    const ilDesc = (il.itemDesc || il.itemName || "");
    const ilSkus = extractSKUs(ilDesc);
    const ilCls = classify(ilDesc);
    const ilSizes = extractSizes(ilDesc);
    const ilQty = Number(il.quantity ?? 0);
    const ilTotal = Number(il.itemTotal ?? 0);

    let tier = null, conf = 0, matchedBillLineId = null, reason = "no candidate";

    // T1: SKU exact match within window
    for (const sku of ilSkus) {
      const cands = (billBySku.get(sku) || []).filter(c =>
        c.billDate && c.billDate >= windowLo && c.billDate <= windowHi
      );
      if (cands.length > 0) {
        const c = cands[0];
        tier = "T1"; conf = 100; matchedBillLineId = c.id;
        reason = `SKU ${sku} exact match · ${c.vendor} ${c.billNo}`;
        break;
      }
    }

    // T2: same-job pipe run (covered by sameJobBill detection)
    if (!tier && sameJobBill && ilCls) {
      for (const sz of ilSizes) {
        const cands = (billBySizeCls.get(`${sz}|${ilCls}`) || []).filter(c =>
          c.billNo === sameJobBill && c.billDate >= windowLo && c.billDate <= windowHi
        );
        if (cands.length > 0) {
          const c = cands[0];
          tier = "T2"; conf = 95; matchedBillLineId = c.id;
          reason = `Same-job pipe run · ${c.vendor} ${c.billNo} L? · size+class match`;
          break;
        }
      }
    }

    // T3: size+class+qty within 25% (or qty equal or qty multiple)
    if (!tier && ilCls) {
      for (const sz of ilSizes) {
        const cands = (billBySizeCls.get(`${sz}|${ilCls}`) || []).filter(c =>
          c.billDate && c.billDate >= windowLo && c.billDate <= windowHi
        );
        let best = null;
        for (const c of cands) {
          let qtyOk = false;
          if (c.qty === ilQty) qtyOk = true;
          else if (c.qty > 0 && ilQty > 0 && Math.abs(c.qty - ilQty) / Math.max(c.qty, ilQty) <= 0.25) qtyOk = true;
          else if (c.qty > 0 && ilQty > 0 && c.qty % ilQty === 0) qtyOk = true; // MOQ overage
          if (qtyOk && (!best || (c.billDate > best.billDate))) best = c;
        }
        if (best) { tier = "T3"; conf = 85; matchedBillLineId = best.id; reason = `Size+class+qty match · ${best.vendor} ${best.billNo}`; break; }
      }
    }

    // T4: size + class only, any qty in window
    if (!tier && ilCls) {
      for (const sz of ilSizes) {
        const cands = (billBySizeCls.get(`${sz}|${ilCls}`) || []).filter(c =>
          c.billDate && c.billDate >= windowLo && c.billDate <= windowHi
        );
        if (cands.length > 0) {
          // pick the closest by date
          const c = cands.sort((a, b) => Math.abs(invDate - a.billDate) - Math.abs(invDate - b.billDate))[0];
          tier = "T4"; conf = 60; matchedBillLineId = c.id; reason = `Size+class only · ${c.vendor} ${c.billNo}`;
          break;
        }
      }
    }

    if (tier === "T1" || tier === "T2") {
      summary.cleared++; lineSum.cleared++; summary.clearedValue += ilTotal; lineSum.clearedValue += ilTotal;
    } else if (tier === "T3" || tier === "T4") {
      summary.suggested++; lineSum.suggested++; summary.suggestedValue += ilTotal; lineSum.suggestedValue += ilTotal;
    } else {
      summary.noMatch++; lineSum.noMatch++; summary.noMatchValue += ilTotal; lineSum.noMatchValue += ilTotal;
    }
    if (tier) summary.byTier[tier]++;
    summary.totalInvoiceLines++;
  }

  perInvoice.push({
    invoice: inv.zohoNumber,
    customer: inv.customerName,
    date: inv.invoiceDate?.toISOString().slice(0,10),
    total: Number(inv.total ?? 0),
    lineCount: inv.lines.length,
    ...lineSum,
  });

  summary.invoicesProcessed++;
}

console.log("══════════════════════════════════════════════════════════════════════════════");
console.log(`SAMPLE MATCHER RESULTS — most recent ${summary.invoicesProcessed} invoices`);
console.log("══════════════════════════════════════════════════════════════════════════════\n");

console.log(`Total invoice lines:    ${summary.totalInvoiceLines}`);
console.log(`  CLEARED  (T1 + T2):   ${summary.cleared.toString().padStart(5)}  £${fmt(summary.clearedValue).padStart(12)}`);
console.log(`  SUGGESTED (T3 + T4):  ${summary.suggested.toString().padStart(5)}  £${fmt(summary.suggestedValue).padStart(12)}`);
console.log(`  NO_MATCH:             ${summary.noMatch.toString().padStart(5)}  £${fmt(summary.noMatchValue).padStart(12)}`);
console.log(`\nTier breakdown:`);
console.log(`  T1 SKU exact:           ${summary.byTier.T1}`);
console.log(`  T2 Same-job pipe run:   ${summary.byTier.T2}`);
console.log(`  T3 Size+class+qty:      ${summary.byTier.T3}`);
console.log(`  T4 Size+class only:     ${summary.byTier.T4}`);

console.log("\n──── Top 15 invoices by uncleared value ────\n");
const byUncleared = perInvoice
  .map(p => ({ ...p, uncleared: p.suggestedValue + p.noMatchValue }))
  .sort((a, b) => b.uncleared - a.uncleared)
  .slice(0, 15);
console.log("  INVOICE        CUSTOMER                          DATE        TOTAL       UNCLEARED   LINES");
for (const p of byUncleared) {
  console.log(`  ${p.invoice.padEnd(12)}  ${(p.customer || "—").slice(0,32).padEnd(32)}  ${p.date}  £${fmt(p.total).padStart(9)}  £${fmt(p.uncleared).padStart(9)}  ${p.lineCount}`);
}

// Verify INV-004841 in sample (regression check)
const w11 = perInvoice.find(p => p.invoice === "INV-004841");
if (w11) {
  console.log(`\n──── Regression check: INV-004841 ────`);
  console.log(JSON.stringify(w11, null, 2));
}

const out = "/tmp/matcher-sample.json";
fs.writeFileSync(out, JSON.stringify({ summary, perInvoice }, null, 2));
console.log(`\nFull results: ${out}`);

await prisma.$disconnect();
await pool.end();

import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (s, n) => (s ?? "").toString().slice(0, n);

const INVOICE_DATE = new Date("2026-04-07");

// Pull EVERY bill line in the staging set, dated on/before invoice date.
// 20k rows in memory is fine.
const all = await prisma.zohoImportedBillLine.findMany({
  where: { bill: { billDate: { lte: INVOICE_DATE } } },
  include: { bill: { select: { zohoNumber: true, vendorName: true, billDate: true } } },
});
console.log(`Loaded ${all.length} bill lines (≤ 2026-04-07)\n`);

// Pre-tokenise descriptions
const indexed = all.map(l => ({
  ...l,
  desc: ((l.itemDesc || l.itemName || "") + "").toLowerCase(),
}));

// Stringent line-only matchers. Each invoice line specifies:
//   sizes:    list of size tokens (e.g. ["28mm", "28 mm"]) — at least one must appear as a word boundary
//   product:  list of needle phrases — at least one must appear in description
//   exclude:  optional list of exclusion phrases (to filter false positives)
//   minTotal/maxTotal: cost-sanity filters (per-line £)
const invoiceLines = [
  {
    no: "L1", label: "28mm × 3M Copper Tube",
    qty: 10, lineTotal: 281.80, rate: 28.18,
    sizes:   ["28mm","28 mm"],
    product: ["copper tube","copper pipe"],
    exclude: ["fitting","coupler","tee","elbow","valve","pressfit","press fit","press-fit","reducer","bend","slip","union","cap","olive"],
  },
  {
    no: "L2", label: "35mm × 3M Copper Tube",
    qty: 10, lineTotal: 497.90, rate: 49.79,
    sizes:   ["35mm","35 mm"],
    product: ["copper tube","copper pipe"],
    exclude: ["fitting","coupler","tee","elbow","valve","pressfit","press fit","press-fit","reducer","bend","slip","union","cap","olive"],
  },
  {
    no: "L3", label: "22mm × 3M Copper Tube",
    qty: 20, lineTotal: 446.60, rate: 22.33,
    sizes:   ["22mm","22 mm"],
    product: ["copper tube","copper pipe"],
    exclude: ["fitting","coupler","tee","elbow","valve","pressfit","press fit","press-fit","reducer","bend","slip","union","cap","olive"],
  },
  {
    no: "L4", label: "15mm × 3M Copper Tube",
    qty: 20, lineTotal: 224.00, rate: 11.20,
    sizes:   ["15mm","15 mm"],
    product: ["copper tube","copper pipe"],
    exclude: ["fitting","coupler","tee","elbow","valve","pressfit","press fit","press-fit","reducer","bend","slip","union","cap","olive"],
  },
  {
    no: "L5", label: "Pressfit Equal Tee 42mm",
    qty: 3, lineTotal: 38.70, rate: 12.90,
    sizes:   ["42mm","42 mm"],
    product: ["equal tee","press tee","pressfit tee","pressfit equal tee","pressfit equal","pressfit  tee"],
    exclude: ["elbow","coupler","reducer","bend","valve"],
  },
  {
    no: "L6", label: "42mm × 3M Copper Tube",
    qty: 4, lineTotal: 235.84, rate: 58.96,
    sizes:   ["42mm","42 mm"],
    product: ["copper tube","copper pipe"],
    exclude: ["fitting","coupler","tee","elbow","valve","pressfit","press fit","press-fit","reducer","bend","slip","union","cap","olive"],
  },
  {
    no: "L7", label: "Amtech Pipe Cutter 15mm",
    qty: 1, lineTotal: 6.50, rate: 6.50,
    sizes:   ["15mm","15 mm"],
    product: ["pipe cutter","tube cutter"],
    exclude: [],
  },
  {
    no: "L8", label: "Amtech Pipe Cutter 22mm",
    qty: 1, lineTotal: 8.00, rate: 8.00,
    sizes:   ["22mm","22 mm"],
    product: ["pipe cutter","tube cutter"],
    exclude: [],
  },
  {
    no: "L9", label: "Amtech Pipe Cutter 28mm",
    qty: 1, lineTotal: 8.99, rate: 8.99,
    sizes:   ["28mm","28 mm"],
    product: ["pipe cutter","tube cutter"],
    exclude: [],
  },
  {
    no: "L10", label: "Cold Water Lever Ball Valve Blue 22mm",
    qty: 1, lineTotal: 5.40, rate: 5.40,
    sizes:   ["22mm","22 mm"],
    product: ["ball valve"],
    // Look for cold water / blue / butterfly handles
    exclude: ["gas","compression"],
  },
  {
    no: "L11", label: "Lever Ball Valve Red 22mm WRAS",
    qty: 1, lineTotal: 5.40, rate: 5.40,
    sizes:   ["22mm","22 mm"],
    product: ["ball valve"],
    exclude: ["gas","compression"],
  },
  {
    no: "L12", label: "35mm Lever Ball Valve Blue",
    qty: 2, lineTotal: 50.00, rate: 25.00,
    sizes:   ["35mm","35 mm"],
    product: ["ball valve"],
    exclude: [],
  },
  {
    no: "L13", label: "35mm Lever Ball Valve Red",
    qty: 2, lineTotal: 50.00, rate: 25.00,
    sizes:   ["35mm","35 mm"],
    product: ["ball valve"],
    exclude: [],
  },
];

function lineMatches(bl, il) {
  const d = bl.desc;
  if (!d) return false;
  // size present
  const sz = il.sizes.some(s => d.includes(s));
  if (!sz) return false;
  // product needle present
  const prod = il.product.some(p => d.includes(p));
  if (!prod) return false;
  // exclusion
  if (il.exclude.some(x => d.includes(x))) return false;
  return true;
}

function rankCandidate(bl, il) {
  // Score 0..100: starts at 50, rate within 30% of invoice rate +20, qty equal +15, qty multiple +5, recent date +10
  let score = 50;
  const r = Number(bl.rate);
  if (Number.isFinite(r) && il.rate > 0) {
    const ratio = r / il.rate;
    if (ratio > 0.5 && ratio < 1.05) score += 20;          // bill rate <= invoice rate (sane markup)
    else if (ratio >= 1.05 && ratio < 1.30) score -= 15;   // bill costs more than invoice (suspicious)
    else if (ratio <= 0.5) score += 5;                     // very cheap — could be different SKU
    else if (ratio >= 1.30) score -= 30;                   // bill far above invoice — unrelated
  }
  const q = Number(bl.quantity);
  if (Number.isFinite(q)) {
    if (q === il.qty) score += 15;
    else if (q > il.qty && q % il.qty === 0) score += 5;     // multiple of invoice qty (MOQ)
    else if (q >= il.qty) score += 3;                        // at least enough
  }
  const days = bl.bill.billDate ? (INVOICE_DATE - bl.bill.billDate) / 86400000 : 9999;
  if (days <= 90) score += 10;
  else if (days <= 365) score += 3;
  else score -= 5;
  return { score, days };
}

console.log("══ INV-004841 line-only matches across ENTIRE bill book (20,508 lines, ≤ 2026-04-07) ══\n");
for (const il of invoiceLines) {
  const candidates = indexed
    .filter(bl => lineMatches(bl, il))
    .map(bl => ({ bl, ...rankCandidate(bl, il) }))
    .sort((a, b) => b.score - a.score);

  console.log(`──── ${il.no}  ${il.label}  ·  invoice qty ${il.qty} × £${fmt(il.rate)} = £${fmt(il.lineTotal)} ────`);
  if (candidates.length === 0) {
    console.log("  (no bill line in entire book matches)");
    console.log();
    continue;
  }
  console.log(`  ${candidates.length} match(es) — top 8 by score:`);
  for (const c of candidates.slice(0, 8)) {
    const b = c.bl.bill;
    const desc = (c.bl.itemDesc || c.bl.itemName || "").replace(/\s+/g," ").slice(0, 58);
    const site = (c.bl.cfSite || "(null)").slice(0, 22);
    const cust = (c.bl.customerName || "(null)").slice(0, 22);
    console.log(`  [${String(c.score).padStart(3)}] ${b.billDate?.toISOString().slice(0,10)} · ${trim(b.vendorName, 22).padEnd(22)} · ${b.zohoNumber.padEnd(20)} · qty ${String(c.bl.quantity).padEnd(6)} × £${fmt(c.bl.rate).padStart(8)} = £${fmt(c.bl.itemTotal).padStart(9)} · site=${site.padEnd(22)} · cust=${cust.padEnd(22)} · ${desc}`);
  }
  if (candidates.length > 8) console.log(`  …(+${candidates.length - 8} more, lower scores)`);
  console.log();
}

await prisma.$disconnect();
await pool.end();

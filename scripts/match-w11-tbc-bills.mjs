import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (s, n) => (s ?? "").toString().slice(0, n);

// Pull every W11 Developments bill line, regardless of site.
// Apply line-level criteria: only product types we care about, only ≤ invoice date.
const all = await prisma.zohoImportedBillLine.findMany({
  where: {
    customerName: "W11 Developments",
    bill: { billDate: { lte: new Date("2026-04-07") } },
  },
  include: { bill: true },
  orderBy: [{ bill: { billDate: "desc" } }],
});
console.log(`Total W11 Developments bill lines (≤ 2026-04-07): ${all.length}\n`);

// Site distribution for those lines
const bySite = new Map();
for (const l of all) {
  const s = l.cfSite || "(null)";
  bySite.set(s, (bySite.get(s) || 0) + 1);
}
console.log("Site distribution of W11 Developments lines:");
for (const [s, n] of [...bySite.entries()].sort((a,b) => b[1]-a[1])) {
  console.log(`  ${s.padEnd(40)} ${n}`);
}
console.log();

// 13 invoice lines on INV-004841 — what we're hunting for
const invoiceLines = [
  { label: "L1  28mm × 3M Copper Tube",      cls: "COPPER",   size: ["28"],   needles: ["copper"] },
  { label: "L2  35mm × 3M Copper Tube",      cls: "COPPER",   size: ["35"],   needles: ["copper"] },
  { label: "L3  22mm × 3M Copper Tube",      cls: "COPPER",   size: ["22"],   needles: ["copper"] },
  { label: "L4  15mm × 3M Copper Tube",      cls: "COPPER",   size: ["15"],   needles: ["copper"] },
  { label: "L5  Pressfit Equal Tee 42mm",    cls: "PRESSFIT", size: ["42"],   needles: ["pressfit", "press fit", "press tee", "press-fit"] },
  { label: "L6  42mm × 3M Copper Tube",      cls: "COPPER",   size: ["42"],   needles: ["copper"] },
  { label: "L7  Amtech Pipe Cutter 15mm",    cls: "CUTTER",   size: ["15"],   needles: ["pipe cutter", "tube cutter", "amtech"] },
  { label: "L8  Amtech Pipe Cutter 22mm",    cls: "CUTTER",   size: ["22"],   needles: ["pipe cutter", "tube cutter", "amtech"] },
  { label: "L9  Amtech Pipe Cutter 28mm",    cls: "CUTTER",   size: ["28"],   needles: ["pipe cutter", "tube cutter", "amtech"] },
  { label: "L10 Cold Water Lever Ball Valve Blue 22mm", cls: "VALVE", size: ["22"], needles: ["ball valve"] },
  { label: "L11 Lever Ball Valve Red 22mm",  cls: "VALVE",    size: ["22"],   needles: ["ball valve"] },
  { label: "L12 35mm Lever Ball Valve Blue", cls: "VALVE",    size: ["35"],   needles: ["ball valve"] },
  { label: "L13 35mm Lever Ball Valve Red",  cls: "VALVE",    size: ["35"],   needles: ["ball valve"] },
];

function match(line, ils) {
  const desc = (line.itemDesc || line.itemName || "").toLowerCase();
  // size match: descrip must contain the size as a token (e.g. "22mm" or "22 mm" or " 22 ")
  const sizeHit = ils.size.some(s => {
    const re = new RegExp(`\\b${s}\\s*mm\\b|\\b${s}m\\b|\\b${s}\\b\\s*x`, "i");
    return re.test(desc);
  });
  if (!sizeHit) return false;
  return ils.needles.some(n => desc.includes(n));
}

// For each invoice line, scan all W11 lines (any site) and report candidates
for (const il of invoiceLines) {
  console.log(`\n──── ${il.label} ────`);
  const candidates = all.filter(l => match(l, il));
  if (candidates.length === 0) {
    console.log("  (no W11 Developments bill line — across ANY site — matches this product/size)");
    continue;
  }
  for (const c of candidates.slice(0, 10)) {
    const b = c.bill;
    const desc = (c.itemDesc || c.itemName || "").replace(/\s+/g, " ").slice(0, 60);
    const site = (c.cfSite || "(null)").slice(0, 22);
    console.log(`  ${b.billDate?.toISOString().slice(0,10)} | ${trim(b.vendorName, 22).padEnd(22)} | ${b.zohoNumber.padEnd(20)} | site=${site.padEnd(22)} | qty ${String(c.quantity).padEnd(6)} × £${fmt(c.rate).padStart(9)} = £${fmt(c.itemTotal).padStart(9)} | ${desc}`);
  }
  if (candidates.length > 10) console.log(`  …(+${candidates.length - 10} more)`);
}

// Bonus: investigate the L2 qty anomaly from before
console.log("\n\n══ Investigating L2 anomaly (Oliver Ashworth 2958/00756052 qty=0.18) ══\n");
const anomaly = await prisma.zohoImportedBillLine.findFirst({
  where: { bill: { zohoNumber: "2958/00756052" }, itemDesc: { contains: "35mm", mode: "insensitive" } },
});
if (anomaly) {
  console.log(`Stored: qty=${anomaly.quantity} rate=£${fmt(anomaly.rate)} total=£${fmt(anomaly.itemTotal)}`);
  console.log(`Raw payload columns of interest:`);
  const p = anomaly.payload || {};
  for (const k of ["Quantity", "Rate", "Item Total", "Usage unit", "Item Name", "Description"]) {
    console.log(`  ${k.padEnd(15)} = ${JSON.stringify(p[k])}`);
  }
}

await prisma.$disconnect();
await pool.end();

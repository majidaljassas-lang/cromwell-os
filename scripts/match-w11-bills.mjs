import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (s, n) => (s ?? "").toString().slice(0, n);

// First — see what site name variants exist that look like Addison Road
console.log("══ Site name variants containing 'Addison' on bill lines ══\n");
const siteVariants = await prisma.$queryRaw`
  SELECT "cfSite", COUNT(*) AS n
  FROM "ZohoImportedBillLine"
  WHERE "cfSite" ILIKE '%addison%'
  GROUP BY "cfSite"
  ORDER BY n DESC
`;
for (const r of siteVariants) {
  console.log(`  '${r.cfSite}' — ${r.n} bill line(s)`);
}

console.log("\n══ Customer name variants matching 'W11' on bill lines ══\n");
const custVariants = await prisma.$queryRaw`
  SELECT "customerName", COUNT(*) AS n
  FROM "ZohoImportedBillLine"
  WHERE "customerName" ILIKE '%w11%'
  GROUP BY "customerName"
  ORDER BY n DESC
`;
for (const r of custVariants) {
  console.log(`  '${r.customerName}' — ${r.n} bill line(s)`);
}

console.log("\n══ Candidate bill lines (Addison Road + before 2026-04-07) ══\n");

// Pull EVERY bill line tagged "83 Addison Road" (any vendor) with date ≤ invoice date
const candidates = await prisma.zohoImportedBillLine.findMany({
  where: {
    cfSite: { contains: "Addison", mode: "insensitive" },
    bill: { billDate: { lte: new Date("2026-04-07") } },
  },
  include: { bill: true },
  orderBy: [{ bill: { billDate: "desc" } }],
});

console.log(`Total candidates by site name (Addison Road, ≤ 2026-04-07): ${candidates.length}\n`);

// Define stringent product matchers based on invoice line keywords
const productPatterns = [
  { label: "COPPER TUBE",   needles: ["copper tube", "copper pipe"] },
  { label: "PRESSFIT TEE",  needles: ["pressfit", "press fit"] },
  { label: "PIPE CUTTER",   needles: ["pipe cutter"] },
  { label: "LEVER BALL VALVE", needles: ["lever ball valve", "ball valve"] },
];

function matchProduct(desc) {
  const d = (desc || "").toLowerCase();
  for (const p of productPatterns) {
    if (p.needles.some(n => d.includes(n))) return p.label;
  }
  return null;
}

// Group candidates by product class
const byClass = new Map();
for (const c of candidates) {
  const desc = c.itemDesc || c.itemName || "";
  const cls = matchProduct(desc);
  if (!cls) continue;
  if (!byClass.has(cls)) byClass.set(cls, []);
  byClass.get(cls).push(c);
}

// Print each candidate alongside what it could relate to
const invoiceLines = [
  { label: "L1  28mm × 3M Copper Tube",      qty: 10, total: 281.80,  cls: "COPPER TUBE", size: "28mm" },
  { label: "L2  35mm × 3M Copper Tube",      qty: 10, total: 497.90,  cls: "COPPER TUBE", size: "35mm" },
  { label: "L3  22mm × 3M Copper Tube",      qty: 20, total: 446.60,  cls: "COPPER TUBE", size: "22mm" },
  { label: "L4  15mm × 3M Copper Tube",      qty: 20, total: 224.00,  cls: "COPPER TUBE", size: "15mm" },
  { label: "L5  Pressfit Equal Tee 42mm",    qty: 3,  total: 38.70,   cls: "PRESSFIT TEE", size: "42mm" },
  { label: "L6  42mm × 3M Copper Tube",      qty: 4,  total: 235.84,  cls: "COPPER TUBE", size: "42mm" },
  { label: "L7  Amtech Pipe Cutter 15mm",    qty: 1,  total: 6.50,    cls: "PIPE CUTTER", size: "15mm" },
  { label: "L8  Amtech Pipe Cutter 22mm",    qty: 1,  total: 8.00,    cls: "PIPE CUTTER", size: "22mm" },
  { label: "L9  Amtech Pipe Cutter 28mm",    qty: 1,  total: 8.99,    cls: "PIPE CUTTER", size: "28mm" },
  { label: "L10 Lever Ball Valve Blue 22mm", qty: 1,  total: 5.40,    cls: "LEVER BALL VALVE", size: "22mm" },
  { label: "L11 Lever Ball Valve Red 22mm",  qty: 1,  total: 5.40,    cls: "LEVER BALL VALVE", size: "22mm" },
  { label: "L12 35mm LEVER BALL VALVE BLUE", qty: 2,  total: 50.00,   cls: "LEVER BALL VALVE", size: "35mm" },
  { label: "L13 35mm LEVER BALL VALVE RED",  qty: 2,  total: 50.00,   cls: "LEVER BALL VALVE", size: "35mm" },
];

for (const il of invoiceLines) {
  console.log(`\n──── INVOICE ${il.label} ──── (${il.qty} × £? = £${fmt(il.total)})`);
  const pool = byClass.get(il.cls) || [];
  // Filter by size token
  const filtered = pool.filter(c => {
    const d = (c.itemDesc || c.itemName || "").toLowerCase();
    return d.includes(il.size.toLowerCase());
  });
  if (filtered.length === 0) {
    console.log(`  (no matching bill lines for ${il.cls} ${il.size} on this site)`);
    continue;
  }
  for (const c of filtered.slice(0, 6)) {
    const b = c.bill;
    const desc = (c.itemDesc || c.itemName || "").replace(/\s+/g, " ").slice(0, 65);
    const uom = c.usageUnit ?? "?";
    const customer = (c.customerName || "(none)").slice(0, 25);
    console.log(`  ${b.billDate?.toISOString().slice(0,10)} | ${trim(b.vendorName, 25).padEnd(25)} | ${b.zohoNumber.padEnd(20)} | qty ${String(c.quantity).padEnd(5)} ${uom.padEnd(6)} × £${fmt(c.rate).padStart(9)} = £${fmt(c.itemTotal).padStart(9)} | cust=${customer.padEnd(25)} | ${desc}`);
  }
  if (filtered.length > 6) console.log(`  …(+${filtered.length - 6} more)`);
}

// UOM check — flag any candidates where supplier UOM is LENGTH/PACK and conversion may be needed
console.log("\n\n══ UOM watch: any Addison Road candidate where UOM ≠ EA ══\n");
const uomCheck = candidates.filter(c => c.usageUnit && !["ea", "each", "no", "nos", null, ""].includes((c.usageUnit||"").toLowerCase()));
for (const c of uomCheck.slice(0, 30)) {
  const desc = (c.itemDesc || c.itemName || "").slice(0, 50);
  console.log(`  ${c.bill.billDate?.toISOString().slice(0,10)} | UOM=${c.usageUnit?.padEnd(8)} | qty=${String(c.quantity).padEnd(6)} × £${fmt(c.rate).padStart(9)} = £${fmt(c.itemTotal).padStart(9)} | ${desc}`);
}
if (uomCheck.length === 0) console.log("  (all candidates are EA — no UOM conversion ambiguity)");

await prisma.$disconnect();
await pool.end();

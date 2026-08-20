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
const WINDOW_DAYS = 60;
const lo = new Date(INVOICE_DATE); lo.setDate(lo.getDate() - WINDOW_DAYS);
const hi = new Date(INVOICE_DATE); hi.setDate(hi.getDate() + WINDOW_DAYS);

console.log(`Window: ${lo.toISOString().slice(0,10)}  →  ${hi.toISOString().slice(0,10)}\n`);

const all = await prisma.zohoImportedBillLine.findMany({
  where: { bill: { billDate: { gte: lo, lte: hi } } },
  include: { bill: { select: { id: true, zohoNumber: true, vendorName: true, billDate: true, total: true } } },
});
console.log(`In-window bill lines (any vendor, any site, any customer): ${all.length}\n`);

// Each invoice line gets:
//   sizes:    word-tokens for the size
//   product:  needle phrases (any one in description)
//   skus:     hard SKU tokens — exact substring on description = automatic match
const invoiceLines = [
  { no: "L1",  label: "28mm × 3M Copper Tube",                  qty: 10, total: 281.80, rate: 28.18,
    sizes: ["28mm","28 mm"], product: ["copper tube","copper pipe"], skus: [] },
  { no: "L2",  label: "35mm × 3M Copper Tube",                  qty: 10, total: 497.90, rate: 49.79,
    sizes: ["35mm","35 mm"], product: ["copper tube","copper pipe"], skus: [] },
  { no: "L3",  label: "22mm × 3M Copper Tube",                  qty: 20, total: 446.60, rate: 22.33,
    sizes: ["22mm","22 mm"], product: ["copper tube","copper pipe"], skus: [] },
  { no: "L4",  label: "15mm × 3M Copper Tube",                  qty: 20, total: 224.00, rate: 11.20,
    sizes: ["15mm","15 mm"], product: ["copper tube","copper pipe"], skus: [] },
  { no: "L5",  label: "Pressfit Equal Tee 42mm",                qty: 3,  total: 38.70,  rate: 12.90,
    sizes: ["42mm","42 mm"], product: ["pressfit","press fit","press-fit","equal tee","press tee"], skus: [] },
  { no: "L6",  label: "42mm × 3M Copper Tube",                  qty: 4,  total: 235.84, rate: 58.96,
    sizes: ["42mm","42 mm"], product: ["copper tube","copper pipe"], skus: [] },
  { no: "L7",  label: "C0260 Amtech Pipe Cutter 15mm",          qty: 1,  total: 6.50,   rate: 6.50,
    sizes: ["15mm","15 mm"], product: ["pipe cutter","tube cutter"], skus: ["c0260"] },
  { no: "L8",  label: "C0265 Amtech Pipe Cutter 22mm",          qty: 1,  total: 8.00,   rate: 8.00,
    sizes: ["22mm","22 mm"], product: ["pipe cutter","tube cutter"], skus: ["c0265"] },
  { no: "L9",  label: "C0270 Amtech Pipe Cutter 28mm",          qty: 1,  total: 8.99,   rate: 8.99,
    sizes: ["28mm","28 mm"], product: ["pipe cutter","tube cutter"], skus: ["c0270"] },
  { no: "L10", label: "Cold Water Lever Ball Valve Blue 22mm",  qty: 1,  total: 5.40,   rate: 5.40,
    sizes: ["22mm","22 mm"], product: ["ball valve"], skus: ["k07065"] },
  { no: "L11", label: "Lever Ball Valve Red 22mm WRAS",         qty: 1,  total: 5.40,   rate: 5.40,
    sizes: ["22mm","22 mm"], product: ["ball valve"], skus: ["k07068"] },
  { no: "L12", label: "35mm Lever Ball Valve Blue",             qty: 2,  total: 50.00,  rate: 25.00,
    sizes: ["35mm","35 mm"], product: ["ball valve"], skus: [] },
  { no: "L13", label: "35mm Lever Ball Valve Red",              qty: 2,  total: 50.00,  rate: 25.00,
    sizes: ["35mm","35 mm"], product: ["ball valve"], skus: [] },
];

const indexed = all.map(l => ({ ...l, desc: ((l.itemDesc || l.itemName || "") + "").toLowerCase() }));

function matches(bl, il) {
  const d = bl.desc;
  if (!d) return null;
  // 1) hard SKU match
  for (const sku of il.skus) {
    if (d.includes(sku)) return "SKU";
  }
  // 2) size + product
  if (il.sizes.some(s => d.includes(s)) && il.product.some(p => d.includes(p))) return "DESC";
  return null;
}

const billsToOpen = new Map(); // billId -> bill object

for (const il of invoiceLines) {
  const hits = [];
  for (const bl of indexed) {
    const m = matches(bl, il);
    if (m) hits.push({ bl, kind: m });
  }
  // sort: SKU first, then by date proximity to invoice
  hits.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "SKU" ? -1 : 1;
    const da = Math.abs(INVOICE_DATE - a.bl.bill.billDate);
    const db = Math.abs(INVOICE_DATE - b.bl.bill.billDate);
    return da - db;
  });

  console.log(`──── ${il.no}  ${il.label}  ·  invoice qty ${il.qty} × £${fmt(il.rate)} = £${fmt(il.total)} ────`);
  if (hits.length === 0) {
    console.log("  (no candidate within ±60 days)");
    console.log();
    continue;
  }
  console.log(`  ${hits.length} candidate(s):`);
  for (const h of hits) {
    const b = h.bl.bill;
    const desc = (h.bl.itemDesc || h.bl.itemName || "").replace(/\s+/g, " ").slice(0, 70);
    const site = (h.bl.cfSite || "—").slice(0, 22);
    const cust = (h.bl.customerName || "—").slice(0, 22);
    const tag = h.kind === "SKU" ? "★SKU" : "    ";
    console.log(`  ${tag} ${b.billDate?.toISOString().slice(0,10)} · ${trim(b.vendorName, 22).padEnd(22)} · ${b.zohoNumber.padEnd(20)} · qty ${String(h.bl.quantity).padEnd(6)} × £${fmt(h.bl.rate).padStart(8)} = £${fmt(h.bl.itemTotal).padStart(9)} · site=${site.padEnd(22)} · cust=${cust.padEnd(22)} · ${desc}`);
    billsToOpen.set(b.id, b);
  }
  console.log();
}

console.log("\n══════════════════════════════════════════════════════════════════════════════");
console.log(`OPENING ALL ${billsToOpen.size} CANDIDATE BILLS IN FULL`);
console.log("══════════════════════════════════════════════════════════════════════════════\n");

for (const [billId, b] of billsToOpen) {
  const full = await prisma.zohoImportedBill.findUnique({
    where: { id: billId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!full) continue;
  console.log(`──── ${full.zohoNumber}  ·  ${full.vendorName}  ·  ${full.billDate?.toISOString().slice(0,10)}  ·  £${fmt(full.total)}  ·  ${full.status}  ────`);
  console.log(`  CF.Site: ${full.payload?.["CF.Site"] ?? "(empty)"}   Customer: ${full.payload?.["Customer Name"] ?? "(empty)"}   PO: ${full.payload?.["PurchaseOrder"] ?? "(empty)"}`);
  for (const l of full.lines) {
    const desc = (l.itemDesc || l.itemName || "").replace(/\s+/g, " ").slice(0, 75);
    console.log(`    L${String(l.lineNumber).padStart(2)}  qty ${String(l.quantity).padEnd(7)} × £${fmt(l.rate).padStart(10)} = £${fmt(l.itemTotal).padStart(11)} · site=${(l.cfSite || "—").padEnd(22)} · cust=${(l.customerName || "—").slice(0,22).padEnd(22)} · ${desc}`);
  }
  console.log();
}

await prisma.$disconnect();
await pool.end();

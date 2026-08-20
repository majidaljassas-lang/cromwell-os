import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Hunt for any 42mm pressfit-style TEE (or even reducing tee or end-feed tee or compression tee)
// across the ENTIRE bill book — no date window.
const all = await prisma.zohoImportedBillLine.findMany({
  include: { bill: { select: { zohoNumber: true, vendorName: true, billDate: true } } },
});

const RX_TEE   = /\b(equal\s*tee|tee\b)/i;
const RX_42MM  = /\b42\s*mm\b/i;

const candidates = all.filter(l => {
  const d = (l.itemDesc || l.itemName || "");
  return RX_TEE.test(d) && RX_42MM.test(d);
});

console.log(`L5 hunt — 42mm tee candidates across the full bill book: ${candidates.length}\n`);
candidates.sort((a, b) => (b.bill.billDate ?? 0) - (a.bill.billDate ?? 0));

for (const c of candidates) {
  const desc = (c.itemDesc || c.itemName || "").replace(/\s+/g, " ").slice(0, 80);
  const site = (c.cfSite || "—").slice(0, 22);
  const cust = (c.customerName || "—").slice(0, 22);
  console.log(`  ${c.bill.billDate?.toISOString().slice(0,10)} · ${c.bill.vendorName?.slice(0,22).padEnd(22)} · ${c.bill.zohoNumber.padEnd(20)} · qty ${String(c.quantity).padEnd(5)} × £${fmt(c.rate).padStart(8)} = £${fmt(c.itemTotal).padStart(9)} · site=${site.padEnd(22)} · cust=${cust.padEnd(22)} · ${desc}`);
}

// Also: any "press" + 42mm fitting at all, in case "equal tee" was mis-described on the invoice
console.log(`\nBroader: any 42mm 'press' fitting the user might have intended:`);
const RX_PRESS = /\b(press|pressfit|press-fit|press fit)\b/i;
const broader = all.filter(l => {
  const d = (l.itemDesc || l.itemName || "");
  return RX_PRESS.test(d) && RX_42MM.test(d);
}).filter(l => !candidates.find(c => c.id === l.id));

broader.sort((a, b) => (b.bill.billDate ?? 0) - (a.bill.billDate ?? 0));
for (const c of broader.slice(0, 25)) {
  const desc = (c.itemDesc || c.itemName || "").replace(/\s+/g, " ").slice(0, 80);
  const site = (c.cfSite || "—").slice(0, 22);
  console.log(`  ${c.bill.billDate?.toISOString().slice(0,10)} · ${c.bill.vendorName?.slice(0,22).padEnd(22)} · ${c.bill.zohoNumber.padEnd(20)} · qty ${String(c.quantity).padEnd(5)} × £${fmt(c.rate).padStart(8)} = £${fmt(c.itemTotal).padStart(9)} · site=${site.padEnd(22)} · ${desc}`);
}
console.log(`  …(+${Math.max(0, broader.length - 25)} more)`);

await prisma.$disconnect();
await pool.end();

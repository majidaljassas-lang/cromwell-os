import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (s, n) => (s ?? "").toString().slice(0, n);

console.log("════════════════════════════════════════════════════════════════════════════════");
console.log("EXAMPLE A — A 'real-site' bill line and the invoice lines on the SAME site");
console.log("════════════════════════════════════════════════════════════════════════════════");

const sample = await prisma.zohoImportedBillLine.findFirst({
  where: { cfSite: "Dellow Centre", customerName: { not: null } },
  include: { bill: true },
});
if (sample) {
  const b = sample.bill;
  console.log(`\nBILL LINE`);
  console.log(`  bill no:       ${b.zohoNumber}`);
  console.log(`  vendor:        ${b.vendorName}`);
  console.log(`  bill date:     ${b.billDate?.toISOString().slice(0,10)}`);
  console.log(`  bill total:    £${fmt(b.total)}`);
  console.log(`  ── line ${sample.lineNumber} ──`);
  console.log(`  description:   ${sample.itemDesc || sample.itemName}`);
  console.log(`  qty × rate:    ${sample.quantity} × £${fmt(sample.rate)} = £${fmt(sample.itemTotal)}`);
  console.log(`  cfSite:        ${sample.cfSite}`);
  console.log(`  customerName:  ${sample.customerName}`);

  console.log(`\nINVOICE LINES on same site (Dellow Centre) for same customer:`);
  const invMatches = await prisma.zohoImportedInvoiceLine.findMany({
    where: { cfSite: "Dellow Centre", invoice: { customerName: sample.customerName } },
    include: { invoice: true },
    take: 8,
  });
  if (invMatches.length === 0) {
    console.log("  (none — try same site, any customer)");
    const any = await prisma.zohoImportedInvoiceLine.findMany({
      where: { cfSite: "Dellow Centre" },
      include: { invoice: true },
      take: 5,
    });
    for (const il of any) {
      console.log(`  - inv ${il.invoice.zohoNumber} | ${trim(il.invoice.customerName, 30).padEnd(30)} | qty ${il.quantity} × £${fmt(il.itemPrice)} = £${fmt(il.itemTotal)} | ${trim(il.itemDesc || il.itemName, 50)}`);
    }
  } else {
    for (const il of invMatches) {
      console.log(`  - inv ${il.invoice.zohoNumber} | qty ${il.quantity} × £${fmt(il.itemPrice)} = £${fmt(il.itemTotal)} | ${trim(il.itemDesc || il.itemName, 50)}`);
    }
  }
}

console.log("\n════════════════════════════════════════════════════════════════════════════════");
console.log("EXAMPLE B — A TBC bill line (this would land in REVIEW until you assign a site)");
console.log("════════════════════════════════════════════════════════════════════════════════");

const tbc = await prisma.zohoImportedBillLine.findFirst({
  where: { cfSite: "TBC", customerName: { not: null }, itemTotal: { gt: 100 } },
  include: { bill: true },
});
if (tbc) {
  const b = tbc.bill;
  console.log(`\nBILL LINE`);
  console.log(`  bill no:       ${b.zohoNumber}`);
  console.log(`  vendor:        ${b.vendorName}`);
  console.log(`  bill date:     ${b.billDate?.toISOString().slice(0,10)}`);
  console.log(`  bill total:    £${fmt(b.total)}`);
  console.log(`  ── line ${tbc.lineNumber} ──`);
  console.log(`  description:   ${tbc.itemDesc || tbc.itemName}`);
  console.log(`  qty × rate:    ${tbc.quantity} × £${fmt(tbc.rate)} = £${fmt(tbc.itemTotal)}`);
  console.log(`  cfSite:        ${tbc.cfSite}`);
  console.log(`  customerName:  ${tbc.customerName}`);
  console.log(`  PurchaseOrder: ${b.payload?.["PurchaseOrder"] || "(empty)"}`);
  console.log(`\nNo cross-reference attempted — site is TBC. User must assign before clearance.`);
}

console.log("\n════════════════════════════════════════════════════════════════════════════════");
console.log("EXAMPLE C — F W Hipkin bill line vs invoice lines for similar items");
console.log("════════════════════════════════════════════════════════════════════════════════");

const hipkin = await prisma.zohoImportedBillLine.findFirst({
  where: { bill: { vendorName: "F W Hipkin" }, cfSite: { notIn: ["TBC", "Multi Site"], not: null } },
  include: { bill: true },
});
if (hipkin) {
  const b = hipkin.bill;
  console.log(`\nBILL LINE`);
  console.log(`  bill no:       ${b.zohoNumber}`);
  console.log(`  vendor:        ${b.vendorName}`);
  console.log(`  bill date:     ${b.billDate?.toISOString().slice(0,10)}`);
  console.log(`  ── line ${hipkin.lineNumber} ──`);
  console.log(`  description:   ${hipkin.itemDesc || hipkin.itemName}`);
  console.log(`  qty × rate:    ${hipkin.quantity} × £${fmt(hipkin.rate)} = £${fmt(hipkin.itemTotal)}`);
  console.log(`  cfSite:        ${hipkin.cfSite}`);
  console.log(`  customerName:  ${hipkin.customerName}`);

  console.log(`\nINVOICE LINES on same site (${hipkin.cfSite}):`);
  const invHip = await prisma.zohoImportedInvoiceLine.findMany({
    where: { cfSite: hipkin.cfSite },
    include: { invoice: true },
    take: 8,
  });
  if (invHip.length === 0) {
    console.log(`  (none — no invoice line tagged site '${hipkin.cfSite}')`);
  } else {
    for (const il of invHip) {
      console.log(`  - inv ${il.invoice.zohoNumber} | ${trim(il.invoice.customerName, 25).padEnd(25)} | £${fmt(il.itemTotal).padStart(10)} | ${trim(il.itemDesc || il.itemName, 60)}`);
    }
  }
}

console.log("\n════════════════════════════════════════════════════════════════════════════════");
console.log("EXAMPLE D — multi-line bill (3+ lines) showing the line-first granularity");
console.log("════════════════════════════════════════════════════════════════════════════════");

const multi = await prisma.zohoImportedBill.findFirst({
  where: { lines: { some: {} } },
  include: { lines: { take: 6 } },
  orderBy: { total: "desc" },
});
if (multi) {
  console.log(`\nBill ${multi.zohoNumber} | ${multi.vendorName} | ${multi.billDate?.toISOString().slice(0,10)} | total £${fmt(multi.total)}`);
  console.log(`Lines (${multi.lines.length} of total):`);
  for (const l of multi.lines) {
    console.log(`  L${l.lineNumber}: qty ${l.quantity} × £${fmt(l.rate).padStart(10)} = £${fmt(l.itemTotal).padStart(10)} | site=${(l.cfSite||"—").padEnd(20)} | cust=${trim(l.customerName, 25).padEnd(25)} | ${trim(l.itemDesc || l.itemName, 50)}`);
  }
}

await prisma.$disconnect();
await pool.end();

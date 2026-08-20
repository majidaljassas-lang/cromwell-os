import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const billCount = await prisma.zohoImportedBill.count();
const lineCount = await prisma.zohoImportedBillLine.count();
console.log(`Bills:  ${billCount}`);
console.log(`Lines:  ${lineCount}`);

const byStatus = await prisma.zohoImportedBill.groupBy({
  by: ["status"], _count: { _all: true }, orderBy: { _count: { id: "desc" } },
});
console.log("\nHeader status distribution:");
for (const r of byStatus) console.log(`  ${(r.status || "(null)").padEnd(20)} ${r._count._all}`);

const cfSiteDistinct = await prisma.$queryRaw`SELECT COUNT(DISTINCT "cfSite") AS d FROM "ZohoImportedBillLine" WHERE "cfSite" IS NOT NULL`;
console.log(`\nDistinct cfSite values: ${cfSiteDistinct[0].d}`);

const cfSiteTop = await prisma.$queryRaw`SELECT "cfSite", COUNT(*) AS c FROM "ZohoImportedBillLine" GROUP BY "cfSite" ORDER BY c DESC LIMIT 8`;
console.log("\nTop cfSite per LINE:");
for (const r of cfSiteTop) console.log(`  ${String(r.c).padStart(6)}  ${r.cfSite ?? "(null)"}`);

// Spot check 1 random paid bill
const sample = await prisma.zohoImportedBill.findFirst({
  where: { status: "Paid" },
  include: { lines: true },
});
if (sample) {
  console.log(`\nSpot check bill ${sample.zohoNumber} (${sample.zohoId}):`);
  console.log(`  vendor: ${sample.vendorName} | total: ${sample.total} | balance: ${sample.balance}`);
  console.log(`  date: ${sample.billDate?.toISOString().slice(0,10)} | lines: ${sample.lines.length}`);
  for (const l of sample.lines.slice(0, 3)) {
    console.log(`   - L${l.lineNumber}: ${(l.itemDesc || l.itemName || "").slice(0,60)} | qty ${l.quantity} × £${l.rate} = £${l.itemTotal} | site: ${l.cfSite ?? "—"}`);
  }
}

await prisma.$disconnect();
await pool.end();

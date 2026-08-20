import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const totals = await prisma.$queryRaw`
  SELECT "clearStatus" AS status,
         COUNT(*) AS lines,
         SUM(COALESCE("itemTotal", 0)) AS total_value
  FROM "ZohoImportedBillLine"
  GROUP BY 1
  ORDER BY total_value DESC NULLS LAST
`;
console.log("Money distribution by clearance status:\n");
console.log("  STATUS       LINES    £ VALUE");
for (const r of totals) {
  const status = r.status ?? "(null)";
  console.log(`  ${status.padEnd(10)} ${String(r.lines).padStart(7)}   £${fmt(r.total_value).padStart(15)}`);
}

console.log("\n--- Top 15 sites by uncleared £ value ---");
const sitesByValue = await prisma.$queryRaw`
  SELECT "cfSite",
         COUNT(*) AS lines,
         SUM(COALESCE("itemTotal", 0)) AS uncleared_value
  FROM "ZohoImportedBillLine"
  WHERE "clearStatus" <> 'CLEARED'
    AND "cfSite" IS NOT NULL AND "cfSite" <> ''
  GROUP BY 1
  ORDER BY uncleared_value DESC
  LIMIT 15
`;
console.log("  SITE                                    LINES   UNCLEARED £");
for (const r of sitesByValue) {
  console.log(`  ${(r.cfSite || "").slice(0,40).padEnd(40)} ${String(r.lines).padStart(5)}   £${fmt(r.uncleared_value).padStart(13)}`);
}

console.log("\n--- TBC + Multi Site cohort ---");
const tbcCohort = await prisma.$queryRaw`
  SELECT
    COALESCE("cfSite", '(null)') AS site,
    COUNT(*) AS lines,
    SUM(COALESCE("itemTotal", 0)) AS value
  FROM "ZohoImportedBillLine"
  WHERE "cfSite" IN ('TBC', 'Multi Site') OR "cfSite" IS NULL OR "cfSite"=''
  GROUP BY 1
  ORDER BY value DESC
`;
for (const r of tbcCohort) {
  console.log(`  ${r.site.padEnd(40)} ${String(r.lines).padStart(5)}   £${fmt(r.value).padStart(13)}`);
}

console.log("\n--- NO_MATCH bills by vendor (top 10) ---");
const noMatchByVendor = await prisma.$queryRaw`
  SELECT b."vendorName" AS vendor,
         COUNT(*) AS lines,
         SUM(COALESCE(l."itemTotal", 0)) AS value
  FROM "ZohoImportedBillLine" l
  JOIN "ZohoImportedBill" b ON b.id = l."billId"
  WHERE l."clearStatus" = 'NO_MATCH'
  GROUP BY 1
  ORDER BY value DESC
  LIMIT 10
`;
for (const r of noMatchByVendor) {
  console.log(`  ${(r.vendor || "(null)").slice(0,40).padEnd(40)} ${String(r.lines).padStart(5)}   £${fmt(r.value).padStart(13)}`);
}

await prisma.$disconnect();
await pool.end();

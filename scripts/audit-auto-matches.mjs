import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const fmt = (n) => Number(n||0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const counts = await prisma.$queryRaw`
  SELECT
    SUM(CASE WHEN "matchReason" LIKE 'T1%' THEN 1 ELSE 0 END) AS t1_count,
    SUM(CASE WHEN "matchReason" LIKE 'T2%' THEN 1 ELSE 0 END) AS t2_count,
    SUM(CASE WHEN "matchReason" NOT LIKE 'T1%' AND "matchReason" NOT LIKE 'T2%' AND "matchedInvoiceLineId" IS NOT NULL THEN 1 ELSE 0 END) AS manual_count,
    SUM(CASE WHEN "matchedInvoiceLineId" IS NULL THEN 1 ELSE 0 END) AS unlinked
  FROM "ZohoImportedBillLine"
`;
const c = counts[0];
console.log("Match origin breakdown:");
console.log(`  T1 (SKU exact)        ${c.t1_count}    ← needs review`);
console.log(`  T2 (same-job cluster) ${c.t2_count}    ← needs review`);
console.log(`  Manual / W11 W&I-day  ${c.manual_count}    ← already user-confirmed`);
console.log(`  Unlinked              ${c.unlinked}`);

await prisma.$disconnect(); await pool.end();

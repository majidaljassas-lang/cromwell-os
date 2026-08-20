import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// CF.Bill status distribution
const cfBillStatus = await prisma.$queryRaw`
  SELECT payload->>'CF.Bill status' AS s, COUNT(*) AS n
  FROM "ZohoImportedBill"
  GROUP BY 1 ORDER BY n DESC LIMIT 15
`;
console.log("CF.Bill status (header) distribution:");
for (const r of cfBillStatus) {
  console.log(`  ${(r.s ?? "(null)").toString().slice(0,40).padEnd(40)} | n=${r.n}`);
}

// PurchaseOrder / Purchase Order Number (which one's actually populated?)
const poFields = await prisma.$queryRaw`
  SELECT
    SUM(CASE WHEN COALESCE(payload->>'PurchaseOrder','') <> '' THEN 1 ELSE 0 END) AS po_top,
    SUM(CASE WHEN COALESCE(payload->>'Purchase Order Number','') <> '' THEN 1 ELSE 0 END) AS po_num,
    SUM(CASE WHEN COALESCE(payload->>'Project Name','') <> '' THEN 1 ELSE 0 END) AS project_name,
    COUNT(*) AS total
  FROM "ZohoImportedBill"
`;
console.log("\nPopulated header fields (out of 6952):");
console.log(`  PurchaseOrder:        ${poFields[0].po_top}`);
console.log(`  Purchase Order Number:${poFields[0].po_num}`);
console.log(`  Project Name:         ${poFields[0].project_name}`);

// Customer Name distribution at LINE level
const custLine = await prisma.$queryRaw`
  SELECT "customerName", COUNT(*) AS n
  FROM "ZohoImportedBillLine"
  GROUP BY 1 ORDER BY n DESC LIMIT 10
`;
console.log("\nTop customerName at LINE level:");
for (const r of custLine) {
  console.log(`  ${(r.customerName ?? "(null)").toString().slice(0,45).padEnd(45)} | n=${r.n}`);
}

// Invoice cross-check — is there a ZohoImportedInvoice table populated?
const invCount = await prisma.zohoImportedInvoice.count();
const invLineCount = await prisma.zohoImportedInvoiceLine.count();
console.log(`\nInvoice staging counts:`);
console.log(`  ZohoImportedInvoice:     ${invCount}`);
console.log(`  ZohoImportedInvoiceLine: ${invLineCount}`);

if (invCount > 0) {
  const invSample = await prisma.zohoImportedInvoice.findFirst({ include: { lines: { take: 1 } } });
  if (invSample) {
    console.log(`  sample inv: ${invSample.zohoNumber} | customer: ${invSample.customerName} | total: ${invSample.total} | lines: ${invSample.lines.length}`);
    if (invSample.lines[0]) {
      const l = invSample.lines[0];
      console.log(`    line cfSite: ${l.cfSite} | desc: ${(l.itemDesc || l.itemName || "").slice(0, 60)}`);
    }
  }
}

// Check: how many bill lines have a non-empty PurchaseOrder field at line level?
const linePo = await prisma.$queryRaw`
  SELECT
    SUM(CASE WHEN COALESCE(payload->>'PurchaseOrder','') <> '' THEN 1 ELSE 0 END) AS line_po,
    SUM(CASE WHEN COALESCE(payload->>'Project Name','') <> '' THEN 1 ELSE 0 END) AS line_proj,
    COUNT(*) AS total
  FROM "ZohoImportedBillLine"
`;
console.log(`\nBill LINE field population (out of ${linePo[0].total}):`);
console.log(`  PurchaseOrder: ${linePo[0].line_po}`);
console.log(`  Project Name:  ${linePo[0].line_proj}`);

// Sample populated PurchaseOrder values
const samples = await prisma.$queryRaw`
  SELECT payload->>'PurchaseOrder' AS po, "vendorName"
  FROM "ZohoImportedBill"
  WHERE COALESCE(payload->>'PurchaseOrder','') <> ''
  LIMIT 8
`;
console.log("\nSample PurchaseOrder values:");
for (const r of samples) {
  console.log(`  vendor=${(r.vendorName||"").slice(0,30).padEnd(30)} | PO="${r.po}"`);
}

await prisma.$disconnect();
await pool.end();

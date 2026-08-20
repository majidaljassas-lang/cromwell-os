import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const fmt = (n) => Number(n||0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const all = await prisma.$queryRaw`
  SELECT
    COUNT(*) AS total_lines,
    SUM(CASE WHEN bl."matchedInvoiceLineId" IS NULL THEN 1 ELSE 0 END) AS unlinked_count,
    SUM(CASE WHEN bl."matchedInvoiceLineId" IS NULL THEN COALESCE(bl."itemTotal"::numeric, 0) ELSE 0 END) AS unlinked_cost,
    SUM(CASE WHEN bl."matchedInvoiceLineId" IS NOT NULL THEN 1 ELSE 0 END) AS linked_count,
    SUM(CASE WHEN bl."matchedInvoiceLineId" IS NOT NULL THEN COALESCE(bl."itemTotal"::numeric, 0) ELSE 0 END) AS linked_cost
  FROM "ZohoImportedBillLine" bl
`;
const closed = await prisma.$queryRaw`
  SELECT
    COUNT(*) AS closed_count,
    SUM(COALESCE(bl."itemTotal"::numeric, 0)) AS closed_cost,
    SUM(COALESCE(il."itemTotal"::numeric, 0)) AS closed_revenue
  FROM "ZohoImportedBillLine" bl
  JOIN "ZohoImportedInvoiceLine" il ON il.id = bl."matchedInvoiceLineId"
  JOIN "ZohoImportedInvoice" inv ON inv.id = il."invoiceId"
  WHERE LOWER(inv.status) IN ('paid', 'closed')
`;
const linkedOpen = await prisma.$queryRaw`
  SELECT
    COUNT(*) AS lo_count,
    SUM(COALESCE(bl."itemTotal"::numeric, 0)) AS lo_cost,
    SUM(COALESCE(il."itemTotal"::numeric, 0)) AS lo_revenue
  FROM "ZohoImportedBillLine" bl
  JOIN "ZohoImportedInvoiceLine" il ON il.id = bl."matchedInvoiceLineId"
  JOIN "ZohoImportedInvoice" inv ON inv.id = il."invoiceId"
  WHERE LOWER(inv.status) NOT IN ('paid', 'closed')
`;

const a = all[0];
const c = closed[0];
const l = linkedOpen[0];
const totalLines = Number(a.total_lines);
const totalCost = Number(a.unlinked_cost) + Number(a.linked_cost);

console.log(`══════════════════════════════════════════════════════════════════════`);
console.log(`FULL-BOOK BILL-LINE CLOSE STATUS (after auto-close)`);
console.log(`══════════════════════════════════════════════════════════════════════`);
console.log(`Total bill lines:    ${totalLines}`);
console.log(`Total cost:          £${fmt(totalCost)}`);
console.log();
console.log(`  CLOSED         ${String(c.closed_count).padStart(6)} (${(Number(c.closed_count)/totalLines*100).toFixed(1)}%)  cost £${fmt(c.closed_cost).padStart(13)}  revenue £${fmt(c.closed_revenue).padStart(13)}`);
console.log(`  LINKED·OPEN    ${String(l.lo_count).padStart(6)} (${(Number(l.lo_count)/totalLines*100).toFixed(1)}%)  cost £${fmt(l.lo_cost).padStart(13)}  revenue £${fmt(l.lo_revenue).padStart(13)}`);
console.log(`  UNLINKED       ${String(a.unlinked_count).padStart(6)} (${(Number(a.unlinked_count)/totalLines*100).toFixed(1)}%)  cost £${fmt(a.unlinked_cost).padStart(13)}                ←  recovery target`);
console.log();
const totalProfit = (Number(c.closed_revenue) + Number(l.lo_revenue)) - (Number(c.closed_cost) + Number(l.lo_cost));
const totalRevenue = Number(c.closed_revenue) + Number(l.lo_revenue);
console.log(`Profit on linked:    £${fmt(totalProfit)}`);
console.log(`Blended margin:      ${totalRevenue > 0 ? (totalProfit/totalRevenue*100).toFixed(1) : "—"}%`);

await prisma.$disconnect(); await pool.end();

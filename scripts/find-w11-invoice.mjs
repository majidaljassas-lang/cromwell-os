import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const trim = (s, n) => (s ?? "").toString().slice(0, n);

// Find any invoices where customerName contains "W11"
const matches = await prisma.zohoImportedInvoice.findMany({
  where: { customerName: { contains: "W11", mode: "insensitive" } },
  orderBy: { invoiceDate: "desc" },
  take: 5,
  include: { lines: true },
});

console.log(`Invoices for any 'W11*' customer: ${matches.length} (showing top 5 by date)\n`);
for (const inv of matches) {
  console.log(`  ${inv.zohoNumber} | ${inv.customerName} | ${inv.invoiceDate?.toISOString().slice(0,10)} | total £${fmt(inv.total)} | balance £${fmt(inv.balance)} | status: ${inv.status}`);
}

if (matches.length === 0) {
  console.log("No invoices found containing 'W11'. Checking customer staging too…");
  const customers = await prisma.zohoImportedContact.findMany({
    where: { OR: [
      { contactName:  { contains: "W11", mode: "insensitive" } },
      { companyName:  { contains: "W11", mode: "insensitive" } },
    ]},
    take: 10,
  });
  console.log(`\nMatching contacts: ${customers.length}`);
  for (const c of customers) {
    console.log(`  ${c.contactName} | company: ${c.companyName} | type: ${c.contactType}`);
  }
}

if (matches.length > 0) {
  const inv = matches[0];
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`LAST INVOICE: ${inv.zohoNumber}`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`Customer:    ${inv.customerName}`);
  console.log(`Customer ID: ${inv.zohoCustomerId}`);
  console.log(`Date:        ${inv.invoiceDate?.toISOString().slice(0,10)}`);
  console.log(`Due:         ${inv.dueDate?.toISOString().slice(0,10) ?? "—"}`);
  console.log(`Status:      ${inv.status}`);
  console.log(`Total:       £${fmt(inv.total)}`);
  console.log(`Balance:     £${fmt(inv.balance)}`);
  console.log(`Lines:       ${inv.lines.length}`);
  console.log();
  console.log(`LINES:`);
  for (const l of inv.lines) {
    console.log(`  L${String(l.lineNumber).padStart(2)}  qty ${String(l.quantity).padEnd(6)} × £${fmt(l.itemPrice).padStart(10)} = £${fmt(l.itemTotal).padStart(11)}  | site: ${(l.cfSite || "—").padEnd(25)} | ${trim(l.itemDesc || l.itemName, 70)}`);
  }
}

await prisma.$disconnect();
await pool.end();

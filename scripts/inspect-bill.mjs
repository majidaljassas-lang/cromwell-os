import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const fmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const target = process.argv[2] || "0001/00346275";

const bill = await prisma.zohoImportedBill.findFirst({
  where: { zohoNumber: target },
  include: { lines: { orderBy: { lineNumber: "asc" } } },
});

if (!bill) {
  console.log(`No bill found with zohoNumber=${target}`);
} else {
  console.log(`════════════════════════════════════════════════════════════════════════════`);
  console.log(`Bill  ${bill.zohoNumber}`);
  console.log(`────────────────────────────────────────────────────────────────────────────`);
  console.log(`vendor:                ${bill.vendorName}`);
  console.log(`bill date:             ${bill.billDate?.toISOString().slice(0,10)}   due ${bill.dueDate?.toISOString().slice(0,10) ?? "—"}`);
  console.log(`total / balance:       £${fmt(bill.total)}  /  £${fmt(bill.balance)}     status ${bill.status}`);
  console.log(`Header CF.Site:        ${bill.payload?.["CF.Site"]   ?? "(empty)"}`);
  console.log(`Header Customer Name:  ${bill.payload?.["Customer Name"] ?? "(empty)"}`);
  console.log(`Header PurchaseOrder:  ${bill.payload?.["PurchaseOrder"] ?? "(empty)"}`);
  console.log(`Header Project Name:   ${bill.payload?.["Project Name"] ?? "(empty)"}`);
  console.log(`Header Branch Name:    ${bill.payload?.["Branch Name"] ?? "(empty)"}`);
  console.log(`Lines: ${bill.lines.length}\n`);

  for (const l of bill.lines) {
    const desc = (l.itemDesc || l.itemName || "").replace(/\s+/g, " ").slice(0, 80);
    console.log(`  L${String(l.lineNumber).padStart(2)}  qty ${String(l.quantity).padEnd(7)} × £${fmt(l.rate).padStart(10)} = £${fmt(l.itemTotal).padStart(11)} | site=${(l.cfSite || "—").padEnd(22)} | cust=${(l.customerName || "—").slice(0,22).padEnd(22)} | ${desc}`);
  }
}

await prisma.$disconnect();
await pool.end();

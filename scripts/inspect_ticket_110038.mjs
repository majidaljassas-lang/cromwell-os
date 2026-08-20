import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const t = await prisma.ticket.findFirst({
  where: { id: { startsWith: "e7a810df" } },
  include: {
    customerPOs: { include: { lines: true } },
    lines: { orderBy: { id: "asc" } },
    invoices: true,
  },
});
if (!t) { console.log("NO TICKET"); process.exit(0); }
console.log("Ticket:", t.id, "no:", t.ticketNo, "ref:", t.customerRef, "site:", t.siteId, "customer:", t.payingCustomerId);
console.log("Lines:", t.lines.length);
for (const l of t.lines) {
  console.log("  ", l.id.slice(0,8), "code:", l.productCode, "desc:", (l.description||"").slice(0,60), "qty:", l.qty, "@", l.actualSaleUnit);
}
console.log("\nCustomer POs:", t.customerPOs.length);
for (const p of t.customerPOs) {
  console.log("  PO", p.poNo, "id:", p.id.slice(0,8), "limit:", p.poLimitValue, "lines:", p.lines.length, "received:", p.receivedAt?.toISOString?.());
  for (const pl of p.lines) {
    console.log("    →line", pl.ticketLineId?.slice(0,8), "desc:", (pl.description||"").slice(0,60), "qty:", pl.qty, "@", pl.agreedUnitPrice);
  }
}
console.log("\nInvoices:", t.invoices.length);
for (const inv of t.invoices) {
  console.log("  ", inv.id?.slice(0,8), "no:", inv.invoiceNo, "status:", inv.status, "total:", inv.total);
}
await prisma.$disconnect(); await pool.end();

#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "f91fd704-6ca9-4fb7-a512-2b113d6a743b";

async function main() {
  const ticket = await prisma.ticket.findUnique({ where: { id: TICKET_ID }, select: { id: true, title: true, status: true } });
  console.log("TICKET:", JSON.stringify(ticket));

  const invoices = await prisma.salesInvoice.findMany({
    where: { ticketId: TICKET_ID },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  console.log("\nSALES INVOICES:", invoices.length);
  for (const inv of invoices) {
    console.log(`  ${inv.invoiceNo} | status=${inv.status} | issuedAt=${inv.issuedAt} | totalNet=${inv.totalNet} totalGross=${inv.totalGross} lines=${inv.lines.length}`);
    for (const l of inv.lines) {
      console.log(`    - ${l.id} ticketLineId=${l.ticketLineId} | ${l.description?.slice(0,50)} | qty=${l.qty} unitPrice=${l.unitPrice} lineTotal=${l.lineTotal} costUnit=${l.costUnit} costTotal=${l.costTotal}`);
    }
  }

  const quotes = await prisma.quote.findMany({
    where: { ticketId: TICKET_ID },
    include: { lines: { orderBy: { sortOrder: "asc" } } },
  });
  console.log("\nQUOTES:", quotes.length);
  for (const q of quotes) {
    console.log(`  ${q.quoteNo} v${q.versionNo} | status=${q.status} | totalSell=${q.totalSell} lines=${q.lines.length}`);
    for (const l of q.lines) {
      console.log(`    - ${l.id} ticketLineId=${l.ticketLineId} | ${l.description?.slice(0,50)} | qty=${l.qty} unitPrice=${l.unitPrice} lineTotal=${l.lineTotal}`);
    }
  }

  const dealSheets = await prisma.dealSheet.findMany({
    where: { ticketId: TICKET_ID },
    select: { id: true, versionNo: true, status: true, createdAt: true },
  });
  console.log("\nDEAL SHEETS:", dealSheets.length);
  for (const d of dealSheets) console.log("  ", JSON.stringify(d));

  const procurementOrders = await prisma.procurementOrder.findMany({
    where: { ticketId: TICKET_ID },
    select: { id: true, poNo: true, status: true, totalCost: true },
  });
  console.log("\nPROCUREMENT ORDERS:", procurementOrders.length);
  for (const po of procurementOrders) console.log("  ", JSON.stringify(po));

  const compSheets = await prisma.compSheet.findMany({
    where: { ticketId: TICKET_ID },
    select: { id: true, status: true, createdAt: true },
  });
  console.log("\nCOMP SHEETS:", compSheets.length);
  for (const c of compSheets) console.log("  ", JSON.stringify(c));
}
main().catch((e)=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());

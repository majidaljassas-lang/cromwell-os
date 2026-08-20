#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const inv = await prisma.salesInvoice.findFirst({
    where: { invoiceNo: "INV-1777540084943" },
    include: {
      lines: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!inv) { console.log("not found"); return; }
  console.log("INVOICE:", inv.invoiceNo, "ticket:", inv.ticketId, "status:", inv.status, "totalNet:", String(inv.totalNet));

  console.log("\n--- INVOICE LINES (in displayOrder) ---");
  for (const l of inv.lines) {
    console.log(`  #${l.displayOrder} | ticketLineId=${l.ticketLineId} | qty=${l.qty} unit=${l.unitPrice} total=${l.lineTotal} mode=${l.displayMode} | ${l.description.slice(0,70)}`);
  }

  console.log("\n--- TICKET LINES (in displayOrder, then createdAt) ---");
  const tlines = await prisma.ticketLine.findMany({
    where: { ticketId: inv.ticketId },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, displayOrder: true, description: true, productCode: true, qty: true, unit: true, sectionLabel: true, parentLineId: true, isBomParent: true, actualSaleUnit: true, actualSaleTotal: true, suggestedSaleUnit: true, lineType: true, status: true, createdAt: true },
  });
  for (const t of tlines) {
    const indent = t.parentLineId ? "    ↳ " : "  ";
    console.log(`${indent}#${t.displayOrder} | ${t.id.slice(0,8)} | parent=${t.parentLineId ? t.parentLineId.slice(0,8) : "-"} bom=${t.isBomParent} | sect="${t.sectionLabel || ""}" | qty=${t.qty} sale=${t.actualSaleUnit ?? t.suggestedSaleUnit} | ${t.description.slice(0,55)}`);
  }
}
main().catch((e)=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());

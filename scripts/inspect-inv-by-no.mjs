#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const invoiceNo = process.argv[2];
  const inv = await prisma.salesInvoice.findFirst({
    where: { invoiceNo },
    include: { lines: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } },
  });
  if (!inv) { console.log("not found"); return; }
  console.log("INVOICE:", inv.invoiceNo, "status:", inv.status, "totalNet:", String(inv.totalNet));
  for (const l of inv.lines) {
    const indent = l.displayMode === "BOM_CHILD" ? "  ↳ " : "    ";
    console.log(`#${String(l.displayOrder).padStart(2)} ${indent}${l.description.slice(0,60)} | qty=${l.qty} unit=${l.unitPrice} total=${l.lineTotal}`);
  }
}
main().finally(() => prisma.$disconnect());

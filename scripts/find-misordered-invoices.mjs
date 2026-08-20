#!/usr/bin/env node
// Find SalesInvoices where BOM_CHILD lines are NOT immediately after their
// parent. Symptom: a child appears at displayOrder N but the line at N-1
// is not the parent (or another child of the same parent). These are
// candidates for the presentation-only reorder fix.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const invs = await prisma.salesInvoice.findMany({
    where: { lines: { some: { displayMode: "BOM_CHILD" } } },
    include: { lines: { include: { ticketLine: { select: { id: true, parentLineId: true } } }, orderBy: [{ displayOrder: "asc" }, { id: "asc" }] } },
  });
  let bad = 0;
  for (const inv of invs) {
    const lines = inv.lines;
    let prevTLId = null;
    let prevParentId = null;
    let misplaced = false;
    for (const l of lines) {
      const tl = l.ticketLine;
      if (l.displayMode === "BOM_CHILD") {
        const parentId = tl.parentLineId;
        // Child's parent must be either the line before it (LINE mode), or
        // a previous child of the same parent.
        if (prevTLId !== parentId && prevParentId !== parentId) {
          misplaced = true;
          break;
        }
      }
      prevTLId = tl.id;
      prevParentId = tl.parentLineId;
    }
    if (misplaced) {
      bad++;
      console.log(`${inv.invoiceNo} | status=${inv.status} | ticketId=${inv.ticketId} | lines=${lines.length}`);
    }
  }
  console.log(`\nTotal misordered: ${bad} of ${invs.length} BOM-bearing invoices.`);
}
main().catch((e)=>{console.error(e);process.exit(1)}).finally(()=>prisma.$disconnect());

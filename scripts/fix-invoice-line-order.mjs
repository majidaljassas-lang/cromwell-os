#!/usr/bin/env node
// Presentation-only fix: re-rank SalesInvoiceLine.displayOrder so BOM
// children sit immediately after their parent and section labels flow
// in ticket order. Does NOT touch unitPrice, lineTotal, or totals — safe
// for SENT / PARTIALLY_PAID / PAID invoices.
//
// Usage: node scripts/fix-invoice-line-order.mjs <invoiceNo>
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const invoiceNo = process.argv[2];
  if (!invoiceNo) { console.error("usage: <invoiceNo>"); process.exit(1); }

  const inv = await prisma.salesInvoice.findFirst({
    where: { invoiceNo },
    include: { lines: { include: { ticketLine: { select: { id: true, displayOrder: true, parentLineId: true } } } } },
  });
  if (!inv) { console.error("not found"); process.exit(1); }

  const tlMap = new Map(inv.lines.map((l) => [l.ticketLine.id, l.ticketLine]));
  const childrenByParent = new Map();
  for (const l of inv.lines) {
    const p = l.ticketLine.parentLineId;
    if (p && tlMap.has(p)) {
      const arr = childrenByParent.get(p) ?? [];
      arr.push(l);
      childrenByParent.set(p, arr);
    }
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.ticketLine.displayOrder - b.ticketLine.displayOrder || a.id.localeCompare(b.id));
  }

  const topLevel = inv.lines
    .filter((l) => l.ticketLine.parentLineId == null)
    .sort((a, b) => a.ticketLine.displayOrder - b.ticketLine.displayOrder || a.id.localeCompare(b.id));

  const ordered = [];
  for (const p of topLevel) {
    ordered.push({ line: p, isBomChild: false });
    for (const k of childrenByParent.get(p.ticketLine.id) ?? []) {
      ordered.push({ line: k, isBomChild: true });
    }
  }

  let rank = 0;
  for (const { line, isBomChild } of ordered) {
    rank++;
    await prisma.salesInvoiceLine.update({
      where: { id: line.id },
      data: {
        displayOrder: rank,
        displayMode: isBomChild ? "BOM_CHILD" : "LINE",
      },
    });
    console.log(`#${rank} ${isBomChild ? "  ↳" : "  "} ${line.description.slice(0, 60)} | unit=${line.unitPrice} total=${line.lineTotal}`);
  }
  console.log(`\nReordered ${rank} lines on ${invoiceNo}. Money fields unchanged.`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

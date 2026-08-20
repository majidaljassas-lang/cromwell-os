#!/usr/bin/env node
// Usage: node scripts/attach-invoice.mjs <INVOICE_NO> <PO_NO> <SRC_PDF> <ISSUED> <DUE> <TOTAL_INC_VAT> <JSON_LINES>
// Lines JSON: [{description,qty,unitPrice}, ...]
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const [, , INVOICE_NO, PO_NO, SRC_PDF, ISSUED_STR, DUE_STR, TOTAL_INC, LINES_JSON] = process.argv;
const LINES = JSON.parse(LINES_JSON);
const ISSUED = new Date(ISSUED_STR);
const DUE = new Date(DUE_STR);

async function main() {
  const existingInv = await prisma.salesInvoice.findFirst({ where: { invoiceNo: INVOICE_NO } });
  if (existingInv) { console.log(`[skip] ${INVOICE_NO} already exists`); return; }

  const po = await prisma.customerPO.findFirst({
    where: { poNo: PO_NO },
    include: { ticket: { include: { lines: true } } },
  });
  if (!po) throw new Error(`PO ${PO_NO} not found`);
  if (!po.ticket) throw new Error("PO has no ticket link");

  const pdfDestName = `${INVOICE_NO}.pdf`;
  const pdfDestAbs = path.join("/Users/majidaljassas/cromwell-os/public/invoices", pdfDestName);
  fs.copyFileSync(SRC_PDF, pdfDestAbs);

  const ticketLines = po.ticket.lines;
  const matchLine = (invDesc) => {
    const d = invDesc.toLowerCase();
    let best = null;
    for (const tl of ticketLines) {
      const tld = (tl.description || "").toLowerCase();
      const code = (tl.productCode || "").toLowerCase();
      if (d.includes(code) && code) return tl;
      if (tld.includes(d.slice(0, 15)) || d.includes(tld.slice(0, 15))) best = tl;
    }
    return best;
  };

  const invoice = await prisma.salesInvoice.create({
    data: {
      ticketId: po.ticketId,
      invoiceNo: INVOICE_NO,
      customerId: po.customerId,
      siteId: po.siteId,
      siteCommercialLinkId: po.siteCommercialLinkId,
      poNo: PO_NO,
      invoiceType: "SALES",
      status: "ISSUED",
      issuedAt: ISSUED,
      dueDate: DUE,
      totalSell: Number(TOTAL_INC),
      notes: `Built from PO ${PO_NO}. PDF: /invoices/${pdfDestName}`,
      lines: {
        create: LINES.map((l) => {
          const tl = matchLine(l.description);
          if (!tl) throw new Error(`No matching ticket line for "${l.description}"`);
          const lineNet = Math.round(l.unitPrice * l.qty * 100) / 100;
          return {
            ticketLineId: tl.id,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: lineNet,
            vatRate: 20,
            vatAmount: Math.round(lineNet * 0.2 * 100) / 100,
            displayMode: "UNIT",
            poMatched: true,
            poMatchStatus: "MATCHED",
          };
        }),
      },
    },
    include: { lines: true },
  });

  await prisma.customerPO.update({ where: { id: po.id }, data: { invoiceNo: INVOICE_NO } });

  const poLines = await prisma.customerPOLine.findMany({ where: { customerPOId: po.id } });
  for (const pl of poLines) {
    const invLine = invoice.lines.find((il) => il.ticketLineId === pl.ticketLineId);
    if (!invLine) continue;
    await prisma.customerPOLine.update({
      where: { id: pl.id },
      data: {
        consumedQty: invLine.qty,
        consumedValue: invLine.lineTotal,
        remainingQty: 0,
        remainingValue: Math.max(0, Number(pl.agreedTotal) - Number(invLine.lineTotal)),
      },
    });
  }

  console.log(`[ok] ${INVOICE_NO} → ${PO_NO} · ${invoice.lines.length} lines · £${invoice.totalSell}`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const INVOICE_NO = "INV-1776174370046";
const PO_NO = "0088/110047";
const ISSUED = new Date("2026-04-14T00:00:00Z");
const DUE = new Date("2026-06-13T00:00:00Z");
const SRC_PDF = "/Users/majidaljassas/Downloads/Cromwell-Invoice-INV-1776174370046.pdf";

const LINES = [
  { description: "McAlpine Adjustable Inlet Bottle Trap", qty: 3, unitPrice: 8.5 },
  { description: "Contract Chrome 65mm Cloakroom Round Head 2 Tap Hole Basin Pillar Tap", qty: 3, unitPrice: 20.0 },
  { description: "Sanitary Fixing Kit", qty: 3, unitPrice: 6.5 },
];

async function main() {
  const existingInv = await prisma.salesInvoice.findFirst({ where: { invoiceNo: INVOICE_NO } });
  if (existingInv) { console.log(`Invoice ${INVOICE_NO} already exists — aborting`); return; }

  const po = await prisma.customerPO.findFirst({
    where: { poNo: PO_NO },
    include: { ticket: { include: { lines: true } } },
  });
  if (!po) throw new Error(`PO ${PO_NO} not found`);
  if (!po.ticket) throw new Error("PO has no ticket link");

  // Copy PDF to public/invoices
  const pdfDestName = `${INVOICE_NO}.pdf`;
  const pdfDestRel = `/invoices/${pdfDestName}`;
  const pdfDestAbs = path.join("/Users/majidaljassas/cromwell-os/public/invoices", pdfDestName);
  fs.copyFileSync(SRC_PDF, pdfDestAbs);
  console.log(`Copied PDF to ${pdfDestRel}`);

  // Match each invoice line back to an existing ticket line
  const ticketLines = po.ticket.lines;
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
      totalSell: 126.0,
      notes: `Built from PO ${PO_NO}. PDF: ${pdfDestRel}`,
      lines: {
        create: LINES.map((l) => {
          const tl = ticketLines.find(
            (t) => t.description.toLowerCase().includes(l.description.toLowerCase().slice(0, 20)) ||
                   l.description.toLowerCase().includes(t.description.toLowerCase().slice(0, 20))
          );
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
  console.log(`Created SalesInvoice ${invoice.invoiceNo} · ${invoice.lines.length} lines · £${invoice.totalSell}`);

  // Set CustomerPO.invoiceNo for the inline field
  await prisma.customerPO.update({ where: { id: po.id }, data: { invoiceNo: INVOICE_NO } });
  console.log(`Tagged PO ${PO_NO} with invoiceNo ${INVOICE_NO}`);

  // Allocate consumed on each PO line
  const poLines = await prisma.customerPOLine.findMany({ where: { customerPOId: po.id } });
  for (const pl of poLines) {
    const invLine = invoice.lines.find((il) => il.ticketLineId === pl.ticketLineId);
    if (!invLine) continue;
    const consumed = Number(invLine.lineTotal);
    const remaining = Math.max(0, Number(pl.agreedTotal) - consumed);
    await prisma.customerPOLine.update({
      where: { id: pl.id },
      data: {
        consumedQty: invLine.qty,
        consumedValue: invLine.lineTotal,
        remainingQty: 0,
        remainingValue: remaining,
      },
    });
  }
  console.log(`Allocated consumption against ${poLines.length} PO lines`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
// Resync every downstream artifact (invoice, quote, deal sheet) for the
// Lusso ticket from the fixed TicketLine source-of-truth. Same VAT rate
// as the existing system constant.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "f91fd704-6ca9-4fb7-a512-2b113d6a743b";
const VAT_RATE = 20;
const r2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const lines = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
  });
  console.log(`Source ticket has ${lines.length} lines.\n`);

  // ---------- SalesInvoice resync ----------
  const invoices = await prisma.salesInvoice.findMany({
    where: { ticketId: TICKET_ID, status: "DRAFT" },
    include: { lines: true },
  });
  for (const inv of invoices) {
    let totalNet = 0;
    for (const tl of lines) {
      const il = inv.lines.find((x) => x.ticketLineId === tl.id);
      const unitPrice = Number(tl.actualSaleUnit ?? tl.suggestedSaleUnit ?? 0);
      const qty = Number(tl.qty);
      const lineTotal = r2(unitPrice * qty);
      const vatAmount = r2(lineTotal * (VAT_RATE / 100));
      totalNet += lineTotal;
      if (il) {
        await prisma.salesInvoiceLine.update({
          where: { id: il.id },
          data: {
            description:  tl.description,
            qty,
            unitPrice,
            lineTotal,
            vatRate:      VAT_RATE,
            vatAmount,
            displayOrder: tl.displayOrder,
          },
        });
      } else {
        await prisma.salesInvoiceLine.create({
          data: {
            salesInvoiceId: inv.id,
            ticketLineId:   tl.id,
            description:    tl.description,
            qty,
            unitPrice,
            lineTotal,
            vatRate:        VAT_RATE,
            vatAmount,
            displayMode:    "STANDARD",
            displayOrder:   tl.displayOrder,
          },
        });
      }
    }
    // Drop any invoice lines whose ticket line no longer exists.
    const ticketLineIds = new Set(lines.map((l) => l.id));
    for (const il of inv.lines) {
      if (!ticketLineIds.has(il.ticketLineId)) {
        await prisma.salesInvoiceLine.delete({ where: { id: il.id } });
      }
    }
    const totalNetR = r2(totalNet);
    const totalVat  = r2(totalNetR * (VAT_RATE / 100));
    const totalGross = r2(totalNetR + totalVat);
    await prisma.salesInvoice.update({
      where: { id: inv.id },
      data: { totalNet: totalNetR, totalVat, totalGross, totalSell: totalNetR },
    });
    console.log(`Invoice ${inv.invoiceNo}: net=${totalNetR}, vat=${totalVat}, gross=${totalGross}`);
  }

  // ---------- Quote resync ----------
  const quotes = await prisma.quote.findMany({
    where: { ticketId: TICKET_ID, status: "DRAFT" },
    include: { lines: true },
  });
  for (const q of quotes) {
    let totalSell = 0;
    for (const tl of lines) {
      const ql = q.lines.find((x) => x.ticketLineId === tl.id);
      const unitPrice = Number(tl.actualSaleUnit ?? tl.suggestedSaleUnit ?? 0);
      const qty = Number(tl.qty);
      const lineTotal = r2(unitPrice * qty);
      totalSell += lineTotal;
      if (ql) {
        await prisma.quoteLine.update({
          where: { id: ql.id },
          data: {
            description: tl.description,
            sectionLabel: tl.sectionLabel,
            sortOrder:   tl.displayOrder,
            qty,
            unitPrice,
            lineTotal,
          },
        });
      } else {
        await prisma.quoteLine.create({
          data: {
            quoteId:      q.id,
            ticketLineId: tl.id,
            description:  tl.description,
            sectionLabel: tl.sectionLabel,
            sortOrder:    tl.displayOrder,
            qty,
            unitPrice,
            lineTotal,
          },
        });
      }
    }
    const ticketLineIds = new Set(lines.map((l) => l.id));
    for (const ql of q.lines) {
      if (!ticketLineIds.has(ql.ticketLineId)) {
        await prisma.quoteLine.delete({ where: { id: ql.id } });
      }
    }
    await prisma.quote.update({ where: { id: q.id }, data: { totalSell: r2(totalSell) } });
    console.log(`Quote ${q.quoteNo} v${q.versionNo}: totalSell=${r2(totalSell)}`);
  }

  // ---------- Deal sheet snapshots ----------
  const snaps = await prisma.dealSheetLineSnapshot.findMany({
    where: { dealSheet: { ticketId: TICKET_ID } },
    select: { id: true, ticketLineId: true },
  });
  console.log(`\nDealSheetLineSnapshot rows: ${snaps.length} (snapshots are immutable history; not modifying)`);

  console.log("\nDONE.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const BOM = {
  "800 x 1000 Shower": [
    "CRR800X1000W Creo Rectangle Shower Tray 800 x 1000 25mm",
    "CRHFWS90_V2 Creo Shower Tray Waste 90mm",
    "1900 x 1000mm Sliding Shower Door",
    "Design Shower Set 3 with Fixed Head & Handset",
  ],
  "Wall Hung Toilet": [
    "3852520A Grohe Rapid SL 1000mm x 500mm Installation Frame w/o Flushplate",
    "3855800M Grohe RAPID-SL Front Wall brackets; Chrome",
    "38732000 Grohe SKATE COSMOPOLITAN WC Wall Plate; Dual Flush; Chrome",
    "Freya Rimless Wall Hung Pan & SC Seat White",
  ],
  "600mm Basin": [
    "nuie Lunar 600mm 1 Drawer Satin White Wall Hung Vanity Unit With Basin",
    "DR110DNC Drift Basin Tap Chrome",
    "BSW0260C Universal Click Clack Basin Waste",
  ],
};

async function main() {
  const quote = await prisma.quote.findFirst({
    where: { quoteNo: "Q-1776097124159", versionNo: 1 },
    include: {
      ticket: true,
      lines: { include: { ticketLine: { include: { components: true } } } },
    },
  });
  if (!quote) throw new Error("Quote not found");

  const ticket = quote.ticket;
  console.log(`Ticket T-${ticket.ticketNo}, ${quote.lines.length} lines`);

  for (const parentDesc of Object.keys(BOM)) {
    const qLine = quote.lines.find((l) => l.description === parentDesc);
    if (!qLine?.ticketLine) {
      console.log(`  [skip] ${parentDesc} — no ticket line`);
      continue;
    }
    const parent = qLine.ticketLine;
    const existing = parent.components || [];
    if (parent.isBomParent && existing.length === BOM[parentDesc].length) {
      console.log(`  [ok] ${parentDesc} — already has ${existing.length} components`);
      continue;
    }
    if (!parent.isBomParent) {
      await prisma.ticketLine.update({ where: { id: parent.id }, data: { isBomParent: true } });
    }
    // Clear any stale components
    if (existing.length) {
      await prisma.ticketLine.deleteMany({ where: { parentLineId: parent.id } });
    }
    for (const comp of BOM[parentDesc]) {
      await prisma.ticketLine.create({
        data: {
          ticketId: ticket.id,
          parentLineId: parent.id,
          lineType: "MATERIAL",
          description: comp,
          qty: 1,
          unit: "EA",
          siteId: parent.siteId,
          siteCommercialLinkId: parent.siteCommercialLinkId,
          payingCustomerId: parent.payingCustomerId,
          status: "CAPTURED",
        },
      });
    }
    console.log(`  [built] ${parentDesc} — ${BOM[parentDesc].length} components`);
  }

  // Regenerate PDFs for v1 and v2 so the BOM shows
  const versions = await prisma.quote.findMany({
    where: { quoteNo: "Q-1776097124159" },
    select: { id: true, versionNo: true, pdfPath: true },
  });
  console.log(`\nClear stale PDFs so next view regenerates with BOM:`);
  for (const v of versions) {
    await prisma.quote.update({ where: { id: v.id }, data: { pdfFileName: null, pdfPath: null, pdfGeneratedAt: null } });
    console.log(`  v${v.versionNo} PDF reset`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CUSTOMER_ID = "970ca49f-4f5a-4308-9c9f-396c3054a251"; // St Georges University Hospital
const SITE_ID = "2988269f-1583-4671-8283-5b127b642fa6";     // St Georges Hospital
const LINK_ID = "be761079-d389-4198-a780-f03686a547a0";     // SiteCommercialLink

const SUPPLIER_NAME = "MEC Medical Ltd";
const SUPPLIER_REF = "Quotation 33925";

// Sell prices computed as cost × (3000/2413), rounded to 2dp,
// with 3p shaved off the last RECALPDGD to hit £3,000.00 exactly.
const LINES = [
  { code: "RECALPDK2",    desc: "RECALIBRATE PRESSURE DROP KIT WITH TWO DIGITAL GAUGES", cert: "37733", cost: 328.00, sell: 407.79 },
  { code: "RECALPDKP2",   desc: "RECALIBRATE PRESSURE DROP KIT WITH 2 DIGITAL GAUGES - PROBE", cert: "37734", cost: 328.00, sell: 407.79 },
  { code: "RECALACN-9",   desc: "RECALIBRATE ANTI CONFUSION NIST X9", cert: "9114", cost: 118.50, sell: 147.33 },
  { code: "RECALCON",     desc: "RECALIBRATE ANTI CONFUSION PROBES", cert: "9604", cost: 108.50, sell: 134.89 },
  { code: "RECALPURGPRO", desc: "RECALIBRATE PARTICULATE & PURG KIT PRO", cert: "71036", cost: 108.00, sell: 134.27 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61030", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61031", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61032", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61033", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61034", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61035", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61036", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61037", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61038", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61039", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61040", cost: 118.50, sell: 147.33 },
  { code: "RECALPDGD",    desc: "RECALIBRATE PRESSURE DROP TEST GUN (DIGITAL) NIST", cert: "61041", cost: 118.50, sell: 147.30 },
];

async function main() {
  const totalCost = LINES.reduce((s, l) => s + l.cost, 0);
  const totalSell = Math.round(LINES.reduce((s, l) => s + l.sell, 0) * 100) / 100;
  if (totalSell !== 3000.00) {
    throw new Error(`Total sell must be £3000.00, got £${totalSell.toFixed(2)}`);
  }
  console.log(`Cost £${totalCost.toFixed(2)}  →  Sell £${totalSell.toFixed(2)}  (uplift £${(totalSell - totalCost).toFixed(2)})`);

  // 1. Ticket
  const ticket = await prisma.ticket.create({
    data: {
      title: "St Georges Hospital — MEC Medical calibration recall",
      description: "Recalibration of pressure drop kits, anti-confusion testers, particulate/purg kit and 12 digital pressure drop test guns. Cost source: MEC Medical Quotation 33925 (18/05/2026, valid until 17/06/2026).",
      siteId: SITE_ID,
      siteCommercialLinkId: LINK_ID,
      payingCustomerId: CUSTOMER_ID,
      ticketMode: "PRICING_FIRST",
      scopeType: "Calibration Services",
      status: "PRICING",
      quoteRequired: true,
      quoteStatus: "DRAFT",
      source: "OTHER",
      sourceRef: "MEC Medical Quotation 33925",
    },
  });
  console.log(`Created ticket T-${ticket.ticketNo} (${ticket.id})`);

  // 2. TicketLines (17, PDF order preserved via displayOrder)
  const ticketLines = [];
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i];
    const tl = await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        displayOrder: i,
        lineType: "SERVICE",
        description: `${l.desc} — Cert ${l.cert}`,
        productCode: l.code,
        specification: `Test Cert No. ${l.cert}`,
        qty: 1,
        unit: "EA",
        siteId: SITE_ID,
        siteCommercialLinkId: LINK_ID,
        payingCustomerId: CUSTOMER_ID,
        status: "READY_FOR_QUOTE",
        supplierName: SUPPLIER_NAME,
        supplierReference: SUPPLIER_REF,
        expectedCostUnit: l.cost,
        expectedCostTotal: l.cost,
        suggestedSaleUnit: l.sell,
        actualSaleUnit: l.sell,
        actualSaleTotal: l.sell,
        expectedMarginTotal: Math.round((l.sell - l.cost) * 100) / 100,
        priceOverride: true,
      },
    });
    ticketLines.push(tl);
  }
  console.log(`Created ${ticketLines.length} TicketLines`);

  // 3. Quote v1 (DRAFT)
  const quoteNo = `Q-${Date.now()}`;
  const quote = await prisma.quote.create({
    data: {
      ticketId: ticket.id,
      quoteNo,
      versionNo: 1,
      quoteType: "STANDARD",
      customerId: CUSTOMER_ID,
      siteId: SITE_ID,
      siteCommercialLinkId: LINK_ID,
      status: "DRAFT",
      issuedAt: new Date(),
      totalSell,
      notes: `Marked up from MEC Medical Quotation 33925. Cost £${totalCost.toFixed(2)} → Sell £${totalSell.toFixed(2)} (uplift £${(totalSell - totalCost).toFixed(2)}, ~24.33%). Carriage TBC per supplier quote.`,
      lines: {
        create: LINES.map((l, i) => ({
          ticketLineId: ticketLines[i].id,
          description: `${l.desc} — Cert ${l.cert}`,
          sortOrder: i,
          qty: 1,
          unitPrice: l.sell,
          lineTotal: l.sell,
        })),
      },
    },
  });
  console.log(`Created Quote ${quoteNo} v1 · DRAFT · totalSell £${quote.totalSell}`);

  console.log(`\nDone.\n  Ticket:  T-${ticket.ticketNo}  (${ticket.id})\n  Quote:   ${quoteNo}\n  /tickets/${ticket.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const CUSTOMER_ID = "b03f6eff-64d3-4b1b-a6bc-ecf1bf7c3406"; // Luc Construction
const SITE_ID = "a255c08f-30e8-43c4-8a0f-309fea749620"; // Thornwood
const SUPPLIER_ID = "a7bf498b-d035-4887-8f73-6eb3d83c8a3a"; // Drainfast
const SUPPLIER_REF = "SQ0119995"; // Drainfast quotation number
const COMPETITOR_BENCHMARK = 3947.40; // Tetiana's best price received (ex VAT) — the price to beat
const TARGET_SALE_TOTAL = 3900.00; // our quote to Luc — beats benchmark by £47.40 ex VAT

// Customer-requested lines (Excel, order preserved). 15° bend dropped; its qty folded into 11.25°.
// (displayOrder, requestedDescription, Drainfast code, qty, unit, costUnit, costTotal)
const LINES = [
  [1, "110mm 45° Double Socket Underground Drainage Junction", "4VF45DY", 20, "EA", 11.15, 223.00],
  [2, "87.5° Triple Socket Equal Junction 110mm",              "4VF90TT", 20, "EA", 12.10, 242.00],
  [3, "Underground Drainage Pipe Single Socket @6m (110mm)",        "4VP6S",  100, "EA", 25.03, 2503.00],
  [4, "110mm 45° Underground Drainage Bend Single Socket",     "4VF45",   20, "EA", 5.53,  110.60],
  [5, "110mm 11.25° Underground Drainage Bend Single Socket",  "4VF11",   40, "EA", 5.53,  221.20],
  [6, "110mm 87.5° Double Socket Rest Bend",                   "4VF90DRB", 20, "EA", 9.59,  191.80],
  [7, "110mm Underground Drainage Coupler",                         "4VF20D",  40, "EA", 2.81,  112.40],
];

const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const costTotal = round2(LINES.reduce((s, l) => s + l[6], 0));
  console.log(`Drainfast cost total: £${costTotal.toFixed(2)} (expect 3604.00)`);
  if (costTotal !== 3604.00) throw new Error(`Cost total ${costTotal} != 3604.00`);

  // Distribute the sale total across lines by markup factor, drift onto the largest (pipe) line.
  const f = TARGET_SALE_TOTAL / costTotal;
  const saleTotals = LINES.map((l) => round2(l[6] * f));
  let sumSale = round2(saleTotals.reduce((s, v) => s + v, 0));
  const drift = round2(TARGET_SALE_TOTAL - sumSale);
  if (drift !== 0) {
    let big = 0;
    saleTotals.forEach((v, i) => { if (v > saleTotals[big]) big = i; });
    saleTotals[big] = round2(saleTotals[big] + drift);
  }
  sumSale = round2(saleTotals.reduce((s, v) => s + v, 0));
  console.log(`Sale total: £${sumSale.toFixed(2)} (target ${TARGET_SALE_TOTAL.toFixed(2)})`);
  if (sumSale !== TARGET_SALE_TOTAL) throw new Error(`Sale total ${sumSale} != target`);

  // Ensure the Luc Construction <-> Thornwood commercial link exists (enforced link rule).
  const scl = await prisma.siteCommercialLink.upsert({
    where: { siteId_customerId_role: { siteId: SITE_ID, customerId: CUSTOMER_ID, role: "MAIN_CONTRACTOR" } },
    update: {},
    create: { siteId: SITE_ID, customerId: CUSTOMER_ID, role: "MAIN_CONTRACTOR", billingAllowed: true, isActive: true },
  });
  console.log(`SiteCommercialLink: ${scl.id} (Luc Construction ↔ Thornwood)`);

  const ticket = await prisma.ticket.create({
    data: {
      title: "Thornwood Drainage Req 86",
      description: `Underground drainage package, Thornwood. Costed against Drainfast quotation ${SUPPLIER_REF} (£${costTotal.toFixed(2)} ex VAT). Competitive bid to beat best price received of £${COMPETITOR_BENCHMARK.toFixed(2)} ex VAT (£${(COMPETITOR_BENCHMARK * 1.2).toFixed(2)} inc). Quoting £${TARGET_SALE_TOTAL.toFixed(2)} ex VAT. 15° bend line dropped per customer — qty folded into 11.25° bends (40 off).`,
      siteId: SITE_ID,
      siteCommercialLinkId: scl.id,
      payingCustomerId: CUSTOMER_ID,
      ticketMode: "COMPETITIVE_BID",
      scopeType: "Underground Drainage",
      status: "PRICING",
      quoteRequired: true,
      quoteStatus: "DRAFT",
      source: "OTHER",
      sourceRef: `Thornwood Drainage Req 86 / Drainfast ${SUPPLIER_REF}`,
    },
  });
  console.log(`Created Ticket T-${ticket.ticketNo} (${ticket.id})`);

  let cumCost = 0, cumSale = 0;
  for (let i = 0; i < LINES.length; i++) {
    const [displayOrder, description, code, qty, unit, costUnit, lineCost] = LINES[i];
    const saleTotal = saleTotals[i];
    cumCost += lineCost; cumSale += saleTotal;

    const line = await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        displayOrder,
        lineType: "MATERIAL",
        description,
        productCode: code,
        specification: `Drainfast quote ${SUPPLIER_REF}, code ${code}. Cost £${costUnit.toFixed(2)}/${unit}.`,
        qty,
        unit,
        siteId: SITE_ID,
        siteCommercialLinkId: scl.id,
        payingCustomerId: CUSTOMER_ID,
        supplierId: SUPPLIER_ID,
        supplierName: "Drainfast",
        supplierReference: SUPPLIER_REF,
        status: "PRICED",
        expectedCostUnit: costUnit,
        expectedCostTotal: lineCost,
        suggestedSaleUnit: saleTotal / qty,
        actualSaleUnit: saleTotal / qty,
        actualSaleTotal: saleTotal,
        sectionLabel: "Underground Drainage — Drainfast SQ0119995",
      },
    });
    // Record Drainfast as the (winning) supplier cost on the line.
    await prisma.ticketLinePrice.create({
      data: {
        ticketLineId: line.id,
        supplierName: "Drainfast",
        supplierId: SUPPLIER_ID,
        costPerUnit: costUnit,
        costTotal: lineCost,
        isWinner: true,
        isManual: true,
        notes: `Drainfast quotation ${SUPPLIER_REF}, code ${code}`,
      },
    });
  }

  const margin = round2(cumSale - cumCost);
  console.log(`Created ${LINES.length} TicketLines`);
  console.log(`Cost £${round2(cumCost).toFixed(2)}  ·  Sale £${round2(cumSale).toFixed(2)}  ·  Margin £${margin.toFixed(2)} (${((margin / cumCost) * 100).toFixed(2)}% on cost)`);
  console.log(`Beats benchmark £${COMPETITOR_BENCHMARK.toFixed(2)} by £${round2(COMPETITOR_BENCHMARK - cumSale).toFixed(2)} ex VAT`);
  console.log(`Ticket URL: /tickets/${ticket.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TITLE = "025-Leicester Place -Cables";
const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb"; // Criterion Developments
const SITE_ID = "770cb47a-b932-409f-bd9e-c5f413ace5ac"; // Leicester Place
const SCL_ID = "f0e7eaa8-e586-4ba2-9e38-4f0086657fe5";
const SUPPLIER_ID = "4351e28b-76fa-4413-ac05-95f6190ff4ab"; // Cleveland Cable Company
const SUPPLIER_REF = "8810978";
const TARGET_SALE_TOTAL = 29432.00;

// Lines as printed on Cleveland Cable quote 8810978 — (qty, productCode, descriptionSingleLine, ratePer1000, costTotal)
const QUOTE_LINES = [
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [100, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,   264.69],
  [ 30, "LSZH2EX16",    "2C+E X 16 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",       6538.65,   196.16],
  [ 30, "LSZH2EX16",    "2C+E X 16 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",       6538.65,   196.16],
  [ 15, "LSZH2EX16",    "2C+E X 16 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",       6538.65,    98.08],
  [ 15, "LSZH2EX16",    "2C+E X 16 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",       6538.65,    98.08],
  [ 24, "LSZH4X70",     "4X70 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN BLUE GREY BLK BASEC",                29654.55,   711.71],
  [ 24, "6491B35EY",    "6491B 35 GREEN/YELLOW LSZH BS-EN 50525-3-41 (H07Z-R) BASEC",                          4104.00,    98.50],
  [ 18, "LSZH5X35",     "5X35 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN, BLUE, GREY, BLACK, GRN/YW BASEC",   19376.86,   348.78],
  [ 21, "LSZH5X35",     "5X35 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN, BLUE, GREY, BLACK, GRN/YW BASEC",   19376.86,   406.91],
  [ 24, "LSZH5X35",     "5X35 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN, BLUE, GREY, BLACK, GRN/YW BASEC",   19376.86,   465.04],
  [ 27, "LSZH5X35",     "5X35 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN, BLUE, GREY, BLACK, GRN/YW BASEC",   19376.86,   523.18],
  [ 42, "LSZH5X50",     "5X50 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN, BLUE, GREY, BLACK, GRN/YW BASEC",   26998.30,  1133.93],
  [ 28, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    54.82],
  [ 28, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    54.82],
  [ 30, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    58.74],
  [ 30, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    58.74],
  [ 30, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    58.74],
  [ 30, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    58.74],
  [ 30, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    58.74],
  [ 43, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    84.19],
  [ 25, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    48.95],
  [ 25, "LSZH2EX4",     "2C+E X 4 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        1957.97,    48.95],
  [ 45, "LSZH5X6CC",    "5X6 XLPE LSZH SWA LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC",   4375.21,   196.88],
  [ 45, "LSZH5X6CC",    "5X6 XLPE LSZH SWA LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC",   4375.21,   196.88],
  [ 45, "LSZH5X16",     "5X16 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC", 10303.52, 463.66],
  [ 15, "LSZH5X16",     "5X16 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC", 10303.52, 154.55],
  [ 15, "LSZH5X16",     "5X16 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC", 10303.52, 154.55],
  [ 45, "LSZH5X25",     "5X25 XLPE, LSZH, SWA, LSZH 1KV BS6724 CORES BRN, BLUE, GREY, BLACK, GRN/YW BASEC",   14143.19,   636.44],
  [ 12, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,    31.76],
  [ 12, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,    31.76],
  [ 12, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,    31.76],
  [ 12, "LSZH2EX6",     "2C+E X 6 XLPE, LSZH, SWA, LSZH BS6724 CORES BROWN, BLUE, GREEN/YELLOW BASEC",        2646.88,    31.76],
  [ 17, "LSZH5X4CC",    "5X4 XLPE LSZH SWA LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC",   3007.05,    51.12],
  [ 15, "LSZH5X4CC",    "5X4 XLPE LSZH SWA LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC",   3007.05,    45.11],
  [ 25, "LSZH5X4CC",    "5X4 XLPE LSZH SWA LSZH 1KV BS6724 CORES BROWN, BLUE, GREY, BLACK, GREEN/YW BASEC",   3007.05,    75.18],
  [4800,"6242B2/5WH",   "6242B 2.5 WHITE LSZH 100M REEL BASEC BS7211",                                         753.28,  3615.74],
  [1900,"6242B4WH",     "6242B 4 WHITE LSZH 100M REEL BASEC BS7211",                                          1116.19,  2120.76],
  [4500,"ENH2X4WHR100", "2C+E X 4 SEC CABLE ENHANCED BS5839-1-02 WHITE 100M REEL BASEC",                      2877.42, 12948.39],
];

function round2(n) { return Math.round(n * 100) / 100; }

async function main() {
  // Sanity: cost total from PDF
  const costTotal = round2(QUOTE_LINES.reduce((s, [, , , , total]) => s + total, 0));
  console.log(`Quote ${SUPPLIER_REF} cost total (sum of lines): £${costTotal.toFixed(2)} (PDF shows £28,030.48)`);

  // Build sale totals at 5% markup, then adjust rounding so SUM == TARGET_SALE_TOTAL
  const saleTotals = QUOTE_LINES.map(([, , , , cost]) => round2(cost * 1.05));
  let sumSale = round2(saleTotals.reduce((s, v) => s + v, 0));
  let drift = round2(TARGET_SALE_TOTAL - sumSale);
  if (drift !== 0) {
    // Put any 1p drift on the largest line
    let largestIdx = 0;
    saleTotals.forEach((v, i) => { if (v > saleTotals[largestIdx]) largestIdx = i; });
    saleTotals[largestIdx] = round2(saleTotals[largestIdx] + drift);
  }
  sumSale = round2(saleTotals.reduce((s, v) => s + v, 0));
  console.log(`Sale total after 5% markup + rounding adjustment: £${sumSale.toFixed(2)} (target £${TARGET_SALE_TOTAL.toFixed(2)})`);
  if (sumSale !== TARGET_SALE_TOTAL) {
    throw new Error(`Sale total ${sumSale} does not match target ${TARGET_SALE_TOTAL}`);
  }

  // Create ticket
  const ticket = await prisma.ticket.create({
    data: {
      title: TITLE,
      description: `Cleveland Cable quotation ${SUPPLIER_REF} — 25 Leicester Place cables package`,
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      payingCustomerId: CUSTOMER_ID,
      ticketMode: "PRICING_FIRST",
      scopeType: "Cables",
      status: "PRICING",
      quoteRequired: true,
      quoteStatus: "DRAFT",
      source: "OTHER",
      sourceRef: `Cleveland Cable Quotation ${SUPPLIER_REF}`,
    },
  });
  console.log(`Created Ticket T-${ticket.ticketNo} (${ticket.id}) — "${ticket.title}"`);

  // Create TicketLines
  let cumulativeSale = 0;
  let cumulativeCost = 0;
  for (let i = 0; i < QUOTE_LINES.length; i++) {
    const [qty, productCode, description, ratePer1000, costTotalLine] = QUOTE_LINES[i];
    const saleTotal = saleTotals[i];
    const costUnit = round2(ratePer1000 / 1000); // £ per metre (4dp held in DB, here 2dp display)
    const saleUnit = round2(saleTotal / qty * 10000) / 10000; // 4dp
    cumulativeSale += saleTotal;
    cumulativeCost += costTotalLine;

    await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        displayOrder: i + 1,
        lineType: "MATERIAL",
        description,
        productCode,
        specification: `Cleveland Cable quote ${SUPPLIER_REF} line ${i + 1}. Rate £${ratePer1000.toFixed(2)} / 1000m. Availability: Ex Stock.`,
        qty,
        unit: "M",
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        payingCustomerId: CUSTOMER_ID,
        supplierId: SUPPLIER_ID,
        supplierName: "Cleveland Cable Company",
        supplierReference: SUPPLIER_REF,
        status: "PRICED",
        expectedCostUnit: ratePer1000 / 1000,
        expectedCostTotal: costTotalLine,
        actualSaleUnit: saleTotal / qty,
        actualSaleTotal: saleTotal,
        suggestedSaleUnit: saleTotal / qty,
        sectionLabel: "Cables — Cleveland Cable 8810978",
      },
    });
  }

  console.log(`Created ${QUOTE_LINES.length} TicketLines`);
  console.log(`Totals: cost £${round2(cumulativeCost).toFixed(2)}  ·  sale £${round2(cumulativeSale).toFixed(2)}  ·  margin £${round2(cumulativeSale - cumulativeCost).toFixed(2)} (${(((cumulativeSale - cumulativeCost) / cumulativeCost) * 100).toFixed(2)}%)`);
  console.log(`\nTicket URL: /tickets/${ticket.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

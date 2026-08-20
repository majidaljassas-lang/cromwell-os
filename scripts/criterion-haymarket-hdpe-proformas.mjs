#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb";
const SITE_ID = "a5b5cb59-9e0a-4f70-9741-1bc3d8cb57c1";
const SCL_ID = "df6fadf7-d0fa-438a-9b88-761481c7a6ab";

const SVP_LABEL = "SVP — Soil & Vent (Akatherm HDPE)";
const RWP_LABEL = "RWP — Rainwater (Akatherm HDPE)";

// [code, description, qty, unitPriceFullPrecision, lineTotalFromSheet]
const SVP_LINES = [
  ["S101100","HDPE 110mm pipe - 5m",441,34.38619047619048,15164.31],
  ["S101600","HDPE 160mm pipe - 5m",31,77.9683870967742,2417.02],
  ["S121145","HDPE 110mm elbow 45°",940,2.7512021276595746,2586.13],
  ["S121645","HDPE 160mm elbow 45°",20,11.263,225.26],
  ["S301611","HDPE 160x110mm branch 45°",89,22.537752808988763,2005.86],
  ["S301111","HDPE 110x110mm branch 45°",132,4.9134090909090915,648.57],
  ["S661140","HDPE 110mm inspection screw cap (long)",110,9.332818181818181,1026.61],
  ["S151611","HDPE 160x110mm reducer concentric",16,4.411875,70.59],
  ["S415695","HDPE 56mm electrofusion coupler",1023,2.1812023460410557,2231.37],
  ["S411195","HDPE 110mm electrofusion coupler",1730,3.3972023121387283,5877.16],
  ["S411695","HDPE 160mm electrofusion coupler",132,7.36060606060606,971.60],
  ["S231120","HDPE 110x110mm cut-out branch 90°",509,14.709803536345776,7487.29],
  ["S421150","HDPE 110mm plug-in socket & cap",503,3.944393638170974,1984.03],
  ["S425650","HDPE 56mm plug-in socket & cap",2024,2.1812005928853755,4414.75],
  ["S251111","HDPE 110x110mm swept branch 88.5°",503,5.031192842942346,2530.69],
  ["S201156","HDPE 110x56mm branch 88.5°",990,4.636,4589.64],
  ["AAV110","Solvent Weld Soil Air Admittance Valve Socket PVCu Black 110mm",85,10.50,892.50],
  ["SP302B/SS302B","FloPlast — Vent Terminal — Black — 110mm",63,2.31,145.53],
  ["S421120","HDPE 110mm expansion socket & cap",512,5.39599609375,2762.75],
  ["S701178","HDPE 110mm x 1/2\" anchor bracket",512,2.945,1507.84],
  ["S301616","HDPE 160x160mm branch 45°",12,22.5375,270.45],
  ["S115692","HDPE 56mm bend 90° (long)",43,1.3604651162790697,58.50],
  ["S105600","HDPE 56mm pipe - 5m",20,14.5845,291.69],
];

const RWP_LINES = [
  ["S101100","HDPE 110mm pipe - 5m",215,34.386186046511625,7393.03],
  ["S101600","HDPE 160mm pipe - 5m",60,77.96833333333333,4678.10],
  ["S121145","HDPE 110mm elbow 45°",209,2.751196172248804,575.00],
  ["S121645","HDPE 160mm elbow 45°",82,11.263170731707318,923.58],
  ["S301611","HDPE 160x110mm branch 45°",19,22.537894736842105,428.22],
  ["S301111","HDPE 110x110mm branch 45°",62,4.913398791540786,304.63],
  ["S661140","HDPE 110mm inspection screw cap (long)",69,9.332753623188406,643.96],
  ["S151611","HDPE 160x110mm reducer concentric",41,4.41170731707317,180.88],
  ["S231620","HDPE 160x110mm cut-out branch 90°",18,34.31777777777778,617.72],
  ["S411195","HDPE 110mm electrofusion coupler",340,3.397205882352941,1155.05],
  ["S411695","HDPE 160mm electrofusion coupler",239,7.360585774058578,1759.18],
  ["S231120","HDPE 110x110mm cut-out branch 90°",59,14.709830508474576,867.88],
  ["S421150","HDPE 110mm plug-in socket & cap",62,3.9443548387096774,244.55],
  ["S251111","HDPE 110x110mm swept branch 88.5°",7,5.031428571428571,35.22],
  ["SP302B/SS302B","FloPlast — Vent Terminal — Black — 110mm",12,2.31,27.72],
  ["S421120","HDPE 110mm expansion socket & cap",42,5.395952380952381,226.63],
  ["S701178","HDPE 110mm x 1/2\" anchor bracket",54,2.945,159.03],
  ["S301616","HDPE 160x160mm branch 45°",25,22.538,563.45],
  ["S111196","HDPE 110mm bend 90° (long)",27,3.2944444444444447,88.95],
  ["S201616","HDPE 160x160mm branch 88.5°",3,24.51,73.53],
  ["S111691","HDPE 160mm bend 90°",3,12.59,37.77],
  ["S100900","HDPE 90mm pipe - 5m",1,25.18,25.18],
  ["S410995","HDPE 90mm electrofusion coupler",5,3.018,15.09],
  ["S421620","HDPE 160mm expansion socket & cap",15,15.678666666666667,235.18],
  ["S701678","HDPE 160mm x 1/2\" anchor bracket",15,3.594666666666667,53.92],
];

async function main() {
  // 1. Create ONE Ticket
  const ticket = await prisma.ticket.create({
    data: {
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      payingCustomerId: CUSTOMER_ID,
      title: "Criterion — Haymarket — HDPE Above-Ground Supply",
      description: "SVP (Soil & Vent) + RWP (Rainwater) — Akatherm HDPE. Material supply for above-ground drainage.",
      ticketMode: "PRICING_FIRST",
      status: "PRICING",
      quoteRequired: true,
      source: "OTHER",
      sourceRef: "price_comparison.xlsx (manual import 2026-05-12)",
    },
  });
  console.log(`Ticket created: ${ticket.id} (#${ticket.ticketNo})`);

  // 2. Create TicketLines
  async function makeLines(rows, sectionLabel, offset) {
    const created = [];
    for (let i = 0; i < rows.length; i++) {
      const [code, desc, qty, unit, total] = rows[i];
      const tl = await prisma.ticketLine.create({
        data: {
          ticketId: ticket.id,
          displayOrder: offset + i,
          lineType: "MATERIAL",
          description: desc,
          productCode: code,
          qty,
          unit: "EA",
          siteId: SITE_ID,
          siteCommercialLinkId: SCL_ID,
          payingCustomerId: CUSTOMER_ID,
          actualSaleUnit: unit,
          actualSaleTotal: total,
          suggestedSaleUnit: unit,
          status: "PRICED",
          sectionLabel,
        },
      });
      created.push({ id: tl.id, code, desc, qty, unit, total });
    }
    return created;
  }

  const svpLines = await makeLines(SVP_LINES, SVP_LABEL, 0);
  const rwpLines = await makeLines(RWP_LINES, RWP_LABEL, SVP_LINES.length);
  console.log(`TicketLines created: ${svpLines.length} SVP + ${rwpLines.length} RWP = ${svpLines.length + rwpLines.length}`);

  // 3. Create two Quotes (one per section) — directly via Prisma so we set
  //    lineTotal exactly to spreadsheet value (not qty*unitPrice rounded).
  const validUntil = new Date("2026-06-11T00:00:00Z");

  async function makeQuote(label, tlines) {
    const quoteNo = `Q-${Date.now()}-${label === SVP_LABEL ? "SVP" : "RWP"}`;
    const totalSell = tlines.reduce((s, l) => s + l.total, 0);
    const quote = await prisma.quote.create({
      data: {
        ticketId: ticket.id,
        quoteNo,
        versionNo: 1,
        quoteType: "STANDARD",
        customerId: CUSTOMER_ID,
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        status: "DRAFT",
        totalSell,
        expiresAt: validUntil,
        lines: {
          create: tlines.map((l, idx) => ({
            ticketLineId: l.id,
            description: `${l.code} — ${l.desc}`,
            sectionLabel: label,
            sortOrder: idx,
            qty: l.qty,
            unitPrice: l.unit,
            lineTotal: l.total,
          })),
        },
      },
    });
    return { id: quote.id, quoteNo, totalSell };
  }

  const svpQuote = await makeQuote(SVP_LABEL, svpLines);
  const rwpQuote = await makeQuote(RWP_LABEL, rwpLines);
  console.log(`Quote SVP: ${svpQuote.quoteNo}  net £${svpQuote.totalSell.toFixed(2)}`);
  console.log(`Quote RWP: ${rwpQuote.quoteNo}  net £${rwpQuote.totalSell.toFixed(2)}`);

  // 4. Generate proformas via the OS API
  async function genProforma(quoteId) {
    const res = await fetch(`http://localhost:3000/api/quotes/${quoteId}/generate-proforma`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: validUntil.toISOString() }),
    });
    if (!res.ok) throw new Error(`generate-proforma ${quoteId} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  const svpPf = await genProforma(svpQuote.id);
  const rwpPf = await genProforma(rwpQuote.id);
  console.log(`Proforma SVP: ${svpPf.proformaNumber}  →  ${svpPf.path}`);
  console.log(`Proforma RWP: ${rwpPf.proformaNumber}  →  ${rwpPf.path}`);

  // 5. Copy PDFs to ~/Downloads for convenience
  const pubDir = path.join(process.cwd(), "public");
  const dlDir = "/Users/majidaljassas/Downloads";
  for (const pf of [svpPf, rwpPf]) {
    const src = path.join(pubDir, pf.path.replace(/^\//, ""));
    const dst = path.join(dlDir, pf.fileName);
    fs.copyFileSync(src, dst);
    console.log(`Copied: ${dst}`);
  }

  console.log("\nDONE.");
  console.log(`Ticket #${ticket.ticketNo} id=${ticket.id}`);
  console.log(`SVP Quote ${svpQuote.quoteNo} → Proforma ${svpPf.proformaNumber}`);
  console.log(`RWP Quote ${rwpQuote.quoteNo} → Proforma ${rwpPf.proformaNumber}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

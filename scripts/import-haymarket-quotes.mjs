#!/usr/bin/env node
// Import Haymarket Quote 1 (HDPE RWP) + Quote 2 (HDPE SVP) onto ticket 145395c2
// Source: /Users/majidaljassas/Downloads/Haymarket_Cromwell_Quotes.xlsx
// Spreadsheet rule: Cost = List -65%, Sale = VIP -5%. Values used verbatim.

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "145395c2-4e77-4bd9-a7e0-362ef365fa4e";
const SITE_ID = "a5b5cb59-9e0a-4f70-9741-1bc3d8cb57c1"; // Haymarket
const SCL_ID = "df6fadf7-d0fa-438a-9b88-761481c7a6ab"; // Criterion Developments MAIN_CONTRACTOR
const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb";

// [code, description, qty, listPrice, costUnit, costTotal, saleUnit, saleTotal]
// null code = blank (AAV / VENT COWLS) — qty only, status CAPTURED, no prices
const RWP = [
  ["S101100", "HDPE 110mm pipe - 5m",                215, 90.49, 31.67,  6809.05, 32.67,  7024.05],
  ["S101600", "HDPE 160mm pipe - 5m",                 60, 205.18, 71.81, 4308.60, 74.07,  4444.20],
  ["S121145", "HDPE 110mm elbow 45°",                209,  7.24,  2.53,   528.77,  2.95,   616.55],
  ["S121645", "HDPE 160mm elbow 45°",                 82, 29.64, 10.37,   850.34, 12.11,   993.02],
  ["S301611", "HDPE 160x110mm branch 45°",            19, 59.31, 20.76,   394.44, 24.22,   460.18],
  ["S301111", "HDPE 110x110mm branch 45°",            62, 12.93,  4.53,   280.86,  5.28,   327.36],
  ["S661140", "HDPE 110mm insp screw cap lng",        69, 24.56,  8.60,   593.40, 10.03,   692.07],
  ["S151611", "HDPE 160x110mm reducer conc",          41, 11.61,  4.06,   166.46,  4.74,   194.34],
  ["S231620", "HDPE 160x110mm c/out brch 90°",        18, 90.31, 31.61,   568.98, 36.89,   664.02],
  ["S411195", "HDPE 110mm electrofusion coupler",    340,  8.94,  3.13,  1064.20,  3.65,  1241.00],
  ["S411695", "HDPE 160mm electrofusion coup",       239, 19.37,  6.78,  1620.42,  7.91,  1890.49],
  ["S231120", "HDPE 110x110mm c/out brch 90°",        59, 38.71, 13.55,   799.45, 15.82,   933.38],
  ["S421150", "HDPE 110mm plug-in sckt & cap",        62, 10.38,  3.63,   225.06,  4.24,   262.88],
  ["S251111", "HDPE 110x110mm swpt brch 88.5°",        7, 13.24,  4.63,    32.41,  5.41,    37.87],
  [null,      "VENT COWLS",                           12, null,  null,    null,   null,    null],
  ["S421120", "HDPE 110mm exp sckt & cap",            42, 14.20,  4.97,   208.74,  5.80,   243.60],
  ["S701178", 'HDPE 110mmx1/2" anchor bracket',       54,  7.75,  2.71,   146.34,  3.18,   171.72],
  ["S301616", "HDPE 160x160mm branch 45°",            25, 59.31, 20.76,   519.00, 24.22,   605.50],
  ["S111196", "HDPE 110mm bend 90°, long",            27,  8.67,  3.03,    81.81, 24.22,   653.94],
  ["S201616", "HDPE 160x160mm branch 88.5°",           3, 64.50, 22.57,    67.71, 24.22,    72.66],
  ["S111691", "HDPE 160mm bend 90°",                   3, 33.13, 11.60,    34.80, 26.35,    79.05],
  ["S100900", "HDPE 90mm Pipe -5m",                    3, 66.26, 23.19,    69.57, 27.07,    81.21],
  ["S410995", "HDPE 90MM ELECTROFUSION COUPLER",       5,  7.94,  2.78,    13.90,  3.24,    16.20],
  ["S421620", "HDPE 160mm exp sckt & cap",            15, 41.26, 14.44,   216.60, 16.85,   252.75],
  ["S701678", 'HDPE 160mmx1/2" anchor bracket',       15,  9.46,  3.31,    49.65,  3.87,    58.05],
];

const SVP = [
  ["S101100", "HDPE 110mm pipe - 5m",                441, 90.49, 31.67, 13966.47, 32.67, 14407.47],
  ["S101600", "HDPE 160mm pipe - 5m",                 31, 205.18, 71.81, 2226.11, 74.07,  2296.17],
  ["S121145", "HDPE 110mm elbow 45°",                940,  7.24,  2.53,  2378.20,  2.77,  2603.80],
  ["S121645", "HDPE 160mm elbow 45°",                 20, 29.64, 10.37,   207.40, 11.31,   226.20],
  ["S301611", "HDPE 160x110mm branch 45°",            89, 59.31, 20.76,  1847.64, 22.64,  2014.96],
  ["S301111", "HDPE 110x110mm branch 45°",           132, 12.93,  4.53,   597.96,  4.93,   650.76],
  ["S661140", "HDPE 110mm insp screw cap lng",       110, 24.56,  8.60,   946.00,  9.38,  1031.80],
  ["S151611", "HDPE 160x110mm reducer conc",          16, 11.61,  4.06,    64.96,  4.44,    71.04],
  ["S415695", "HDPE 56mm electrofusion coup",       1023,  5.74,  2.01,  2056.23,  2.18,  2230.14],
  ["S411195", "HDPE 110mm electrofusion coupler",   1730,  8.94,  3.13,  5414.90,  3.41,  5899.30],
  ["S411695", "HDPE 160mm electrofusion coup",       132, 19.37,  6.78,   894.96,  7.39,   975.48],
  ["S231120", "HDPE 110x110mm c/out brch 90°",       509, 38.71, 13.55,  6896.95, 14.78,  7523.02],
  ["S421150", "HDPE 110mm plug-in sckt & cap",       503, 10.38,  3.63,  1825.89,  3.96,  1991.88],
  ["S425650", "HDPE 56mm plug-in sckt & cap",       2024,  5.74,  2.01,  4068.24,  2.18,  4412.32],
  ["S251111", "HDPE 110x110mm swpt brch 88.5°",      503, 13.24,  4.63,  2328.89,  5.05,  2540.15],
  ["S201156", "HDPE 110x56mm branch 88.5°",          990, 12.20,  4.27,  4227.30,  4.66,  4613.40],
  [null,      "AAV",                                  85, null,  null,    null,   null,    null],
  [null,      "VENT COWLS",                           63, null,  null,    null,   null,    null],
  ["S421120", "HDPE 110mm exp sckt & cap",           512, 14.20,  4.97,  2544.64,  5.42,  2775.04],
  ["S701178", 'HDPE 110mmx1/2" anchor bracket',      512,  7.75,  2.71,  1387.52,  2.95,  1510.40],
  ["S301616", "HDPE 160x160mm branch 45°",            12, 59.31, 20.76,   249.12, 22.64,   271.68],
  ["S115692", "HDPE 56mm bend 90°, long",             43,  3.58,  1.25,    53.75,  1.37,    58.91],
  ["S105600", "HDPE 56mm pipe - 5m",                  20, 38.38, 13.43,   268.60, 15.67,   313.40],
];

const RWP_LABEL = "Quote 1 — HDPE RWP";
const SVP_LABEL = "Quote 2 — HDPE SVP";

async function buildLines(rows, label, displayStart) {
  const created = [];
  for (let i = 0; i < rows.length; i++) {
    const [code, desc, qty, listPx, costUnit, costTotal, saleUnit, saleTotal] = rows[i];
    const isBlank = code === null;
    const data = {
      ticketId: TICKET_ID,
      displayOrder: displayStart + i,
      lineType: "MATERIAL",
      description: desc,
      productCode: code,
      qty,
      unit: "EA",
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      payingCustomerId: CUSTOMER_ID,
      sectionLabel: label,
      status: isBlank ? "CAPTURED" : "READY_FOR_QUOTE",
    };
    if (!isBlank) {
      data.benchmarkUnit = listPx;
      data.benchmarkTotal = +(listPx * qty).toFixed(2);
      data.expectedCostUnit = costUnit;
      data.expectedCostTotal = costTotal;
      data.suggestedSaleUnit = saleUnit;
      data.actualSaleUnit = saleUnit;
      data.actualSaleTotal = saleTotal;
      data.expectedMarginTotal = +(saleTotal - costTotal).toFixed(2);
      data.actualMarginTotal = +(saleTotal - costTotal).toFixed(2);
      data.evidenceStatus = "PRICED_FROM_TPL_MAY_2026";
      data.costStatus = "EXPECTED";
      data.salesStatus = "READY_FOR_QUOTE";
    }
    const tl = await prisma.ticketLine.create({ data });
    created.push({ tl, isBlank });
  }
  return created;
}

async function buildQuote({ versionNo, quoteNoSuffix, label, lines, notes }) {
  const priced = lines.filter((l) => !l.isBlank);
  const totalSell = +priced.reduce((s, l) => s + Number(l.tl.actualSaleTotal), 0).toFixed(2);

  const quoteNo = `Q-${Date.now()}-${quoteNoSuffix}`;
  const quote = await prisma.quote.create({
    data: {
      ticketId: TICKET_ID,
      quoteNo,
      versionNo,
      quoteType: "STANDARD",
      customerId: CUSTOMER_ID,
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      status: "DRAFT",
      totalSell,
      notes,
      lines: {
        create: priced.map((l, idx) => ({
          ticketLineId: l.tl.id,
          description: l.tl.description,
          sectionLabel: label,
          sortOrder: idx,
          qty: l.tl.qty,
          unitPrice: l.tl.actualSaleUnit,
          lineTotal: l.tl.actualSaleTotal,
        })),
      },
    },
  });
  return { quote, totalSell, blankCount: lines.length - priced.length };
}

async function main() {
  // Guard against re-run
  const existing = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    select: { id: true },
  });
  if (existing.length > 0) {
    console.log(`ABORT: ticket already has ${existing.length} lines. Delete them first if re-importing.`);
    return;
  }

  // 1) Wire site + scope onto ticket
  await prisma.ticket.update({
    where: { id: TICKET_ID },
    data: {
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      scopeType: "HDPE Soil & Rainwater pipework",
    },
  });
  console.log(`Ticket wired to Haymarket / Criterion Developments`);

  // 2) Build TicketLines for both quotes
  const rwpLines = await buildLines(RWP, RWP_LABEL, 1);
  console.log(`Created ${rwpLines.length} RWP TicketLines (${rwpLines.filter(l => l.isBlank).length} blank)`);
  const svpLines = await buildLines(SVP, SVP_LABEL, 1 + RWP.length);
  console.log(`Created ${svpLines.length} SVP TicketLines (${svpLines.filter(l => l.isBlank).length} blank)`);

  // 3) Build Quote 1 (RWP)
  const q1 = await buildQuote({
    versionNo: 1,
    quoteNoSuffix: "RWP",
    label: RWP_LABEL,
    lines: rwpLines,
    notes: `HDPE Rainwater Pipework. Source: Haymarket_Cromwell_Quotes.xlsx (Aliaxis UK TPL May 2026). Cost = List -65%, Sale = VIP -5%. ${rwpLines.filter(l => l.isBlank).length} line(s) pending price (VENT COWLS).`,
  });
  console.log(`Quote 1 created · ${q1.quote.quoteNo} · totalSell £${q1.totalSell}`);

  // 4) Build Quote 2 (SVP)
  const q2 = await buildQuote({
    versionNo: 2,
    quoteNoSuffix: "SVP",
    label: SVP_LABEL,
    lines: svpLines,
    notes: `HDPE Soil & Vent Pipework. Source: Haymarket_Cromwell_Quotes.xlsx (Aliaxis UK TPL May 2026). Cost = List -65%, Sale = VIP -5%. ${svpLines.filter(l => l.isBlank).length} line(s) pending price (AAV, VENT COWLS).`,
  });
  console.log(`Quote 2 created · ${q2.quote.quoteNo} · totalSell £${q2.totalSell}`);

  // 5) Update ticket status to QUOTED
  await prisma.ticket.update({
    where: { id: TICKET_ID },
    data: { status: "QUOTED", quoteRequired: true, quoteStatus: "DRAFT", quotedAt: new Date() },
  });

  // 6) Create review task for the 3 blank lines
  const blanks = [...rwpLines, ...svpLines].filter(l => l.isBlank);
  if (blanks.length > 0) {
    await prisma.task.create({
      data: {
        ticketId: TICKET_ID,
        taskType: "PRICING_REVIEW",
        priority: "HIGH",
        status: "OPEN",
        generatedReason: `Source spreadsheet has ${blanks.length} unpriced lines (AAV / VENT COWLS) — fill cost & sale before issuing quotes.`,
        draftBody: blanks.map(l => `• ${l.tl.description} qty ${l.tl.qty} (${l.tl.sectionLabel})`).join("\n"),
      },
    });
    console.log(`Task created · PRICING_REVIEW for ${blanks.length} unpriced lines`);
  }

  // 7) Sanity check totals against spreadsheet
  console.log("\n— Reconciliation —");
  console.log(`Quote 1 RWP    : OS £${q1.totalSell.toFixed(2)}  | sheet £22016.09  | diff £${(q1.totalSell - 22016.09).toFixed(2)}`);
  console.log(`Quote 2 SVP    : OS £${q2.totalSell.toFixed(2)}  | sheet £58417.32  | diff £${(q2.totalSell - 58417.32).toFixed(2)}`);
  console.log(`Combined sale  : OS £${(q1.totalSell + q2.totalSell).toFixed(2)}  | sheet £80433.41`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

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

const SVP_TICKET_ID = "e86ce26e-7d16-4885-8771-c50ff70a29cb";
const RWP_TICKET_ID = "7f751858-0d33-4b44-a57d-096988c8a7c2";

const round2 = (n) => Math.round(n * 100) / 100;

// Spreadsheet data: [code, qty, unitFullPrecision, lineTotal2dp]
const SVP = [
  ["S101100",441,34.38619047619048,15164.31],
  ["S101600",31,77.9683870967742,2417.02],
  ["S121145",940,2.7512021276595746,2586.13],
  ["S121645",20,11.263,225.26],
  ["S301611",89,22.537752808988763,2005.86],
  ["S301111",132,4.9134090909090915,648.57],
  ["S661140",110,9.332818181818181,1026.61],
  ["S151611",16,4.411875,70.59],
  ["S415695",1023,2.1812023460410557,2231.37],
  ["S411195",1730,3.3972023121387283,5877.16],
  ["S411695",132,7.36060606060606,971.60],
  ["S231120",509,14.709803536345776,7487.29],
  ["S421150",503,3.944393638170974,1984.03],
  ["S425650",2024,2.1812005928853755,4414.75],
  ["S251111",503,5.031192842942346,2530.69],
  ["S201156",990,4.636,4589.64],
  ["AAV110",85,10.50,892.50],
  ["SP302B/SS302B",63,2.31,145.53],
  ["S421120",512,5.39599609375,2762.75],
  ["S701178",512,2.945,1507.84],
  ["S301616",12,22.5375,270.45],
  ["S115692",43,1.3604651162790697,58.50],
  ["S105600",20,14.5845,291.69],
];

const RWP = [
  ["S101100",215,34.386186046511625,7393.03],
  ["S101600",60,77.96833333333333,4678.10],
  ["S121145",209,2.751196172248804,575.00],
  ["S121645",82,11.263170731707318,923.58],
  ["S301611",19,22.537894736842105,428.22],
  ["S301111",62,4.913398791540786,304.63],
  ["S661140",69,9.332753623188406,643.96],
  ["S151611",41,4.41170731707317,180.88],
  ["S231620",18,34.31777777777778,617.72],
  ["S411195",340,3.397205882352941,1155.05],
  ["S411695",239,7.360585774058578,1759.18],
  ["S231120",59,14.709830508474576,867.88],
  ["S421150",62,3.9443548387096774,244.55],
  ["S251111",7,5.031428571428571,35.22],
  ["SP302B/SS302B",12,2.31,27.72],
  ["S421120",42,5.395952380952381,226.63],
  ["S701178",54,2.945,159.03],
  ["S301616",25,22.538,563.45],
  ["S111196",27,3.2944444444444447,88.95],
  ["S201616",3,24.51,73.53],
  ["S111691",3,12.59,37.77],
  ["S100900",1,25.18,25.18],
  ["S410995",5,3.018,15.09],
  ["S421620",15,15.678666666666667,235.18],
  ["S701678",15,3.594666666666667,53.92],
];

async function applyToTicket(ticketId, rows, sectionLabel) {
  const tls = await prisma.ticketLine.findMany({
    where: { ticketId },
    orderBy: { displayOrder: "asc" },
  });
  if (tls.length !== rows.length) {
    throw new Error(`${sectionLabel}: TicketLine count ${tls.length} != spreadsheet count ${rows.length}`);
  }

  // 1. Update each TicketLine: actualSaleUnit (full precision → DB truncates to 4dp via banker's),
  //    actualSaleTotal (spreadsheet 2dp). Raw SQL bypasses ticket-line-sync extension.
  for (let i = 0; i < tls.length; i++) {
    const tl = tls[i];
    const [code, qty, unit, total] = rows[i];
    if (tl.productCode !== code) throw new Error(`${sectionLabel}#${i} productCode mismatch: TL=${tl.productCode} spreadsheet=${code}`);
    await prisma.$executeRawUnsafe(
      `UPDATE "TicketLine" SET "actualSaleUnit" = $1::numeric, "actualSaleTotal" = $2::numeric WHERE id = $3`,
      String(unit), String(total), tl.id,
    );
  }

  // 2. Locate the single Quote on this ticket, then rebuild QuoteLines from scratch
  const quote = await prisma.quote.findFirst({ where: { ticketId } });
  if (!quote) throw new Error(`No quote for ${sectionLabel}`);
  await prisma.$executeRawUnsafe(`DELETE FROM "QuoteLine" WHERE "quoteId" = $1`, quote.id);

  const refreshed = await prisma.ticketLine.findMany({ where: { ticketId }, orderBy: { displayOrder: "asc" } });
  let totalSell = 0;
  for (const tl of refreshed) {
    const unit = Number(tl.actualSaleUnit);
    const qty = Number(tl.qty);
    const lineTotal = Number(tl.actualSaleTotal);
    const description = tl.productCode ? `${tl.productCode} — ${tl.description}` : tl.description;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QuoteLine" (id, "quoteId", "ticketLineId", description, "sectionLabel", "sortOrder", qty, "unitPrice", "lineTotal")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
      quote.id, tl.id, description, tl.sectionLabel, tl.displayOrder, qty, unit, lineTotal,
    );
    totalSell += lineTotal;
  }
  totalSell = round2(totalSell);
  await prisma.quote.update({ where: { id: quote.id }, data: { totalSell } });
  return { quoteId: quote.id, total: totalSell, lines: refreshed.length };
}

async function main() {
  const svp = await applyToTicket(SVP_TICKET_ID, SVP, "SVP");
  const rwp = await applyToTicket(RWP_TICKET_ID, RWP, "RWP");
  console.log(`SVP rebuilt: ${svp.lines} lines, total £${svp.total.toFixed(2)}`);
  console.log(`RWP rebuilt: ${rwp.lines} lines, total £${rwp.total.toFixed(2)}`);
  if (svp.total !== 60160.14) console.warn(`!! SVP total ${svp.total} != spreadsheet 60160.14`);
  if (rwp.total !== 21313.45) console.warn(`!! RWP total ${rwp.total} != spreadsheet 21313.45`);

  // Re-render Pro-Formas
  const validUntil = new Date("2026-06-12T00:00:00Z");
  async function genProforma(quoteId) {
    const res = await fetch(`http://localhost:3000/api/quotes/${quoteId}/generate-proforma`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: validUntil.toISOString() }),
    });
    if (!res.ok) throw new Error(`generate-proforma ${quoteId} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  const svpPf = await genProforma(svp.quoteId);
  const rwpPf = await genProforma(rwp.quoteId);
  console.log(`Proforma SVP: ${svpPf.proformaNumber}  net £${svpPf.totalSale.toFixed?.(2) ?? svpPf.totalSale}  →  ${svpPf.path}`);
  console.log(`Proforma RWP: ${rwpPf.proformaNumber}  net £${rwpPf.totalSale.toFixed?.(2) ?? rwpPf.totalSale}  →  ${rwpPf.path}`);

  // Copy to ~/Downloads
  const pubDir = path.join(process.cwd(), "public");
  const dlDir = "/Users/majidaljassas/Downloads";
  for (const pf of [svpPf, rwpPf]) {
    const src = path.join(pubDir, pf.path.replace(/^\//, ""));
    const dst = path.join(dlDir, pf.fileName);
    fs.copyFileSync(src, dst);
    console.log(`Copied: ${dst}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

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

const TICKET_ID = "e86ce26e-7d16-4885-8771-c50ff70a29cb";
const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb";
const SITE_ID = "a5b5cb59-9e0a-4f70-9741-1bc3d8cb57c1";
const SCL_ID = "df6fadf7-d0fa-438a-9b88-761481c7a6ab";

const SVP_LABEL = "SVP — Soil & Vent (Akatherm HDPE)";
const RWP_LABEL = "RWP — Rainwater (Akatherm HDPE)";

// PO 11739 / SVP — line totals per PO (qty × 2dp unit)
const SVP_PO_TOTALS = [
  ["S101100", 15165.99],
  ["S101600", 2417.07],
  ["S121145", 2585.00],
  ["S121645", 225.20],
  ["S301611", 2006.06],
  ["S301111", 648.12],
  ["S661140", 1026.30],
  ["S151611", 70.56],
  ["S415695", 2230.14],
  ["S411195", 5882.00],
  ["S411695", 971.52],
  ["S231120", 7487.39],
  ["S421150", 1981.82],
  ["S425650", 4412.32],
  ["S251111", 2530.09],
  ["S201156", 4593.60],
  ["AAV110", 892.50],
  ["SP302B/SS302B", 145.53],
  ["S421120", 2764.80],
  ["S701178", 1510.40],
  ["S301616", 270.48],
  ["S115692", 58.48],
  ["S105600", 291.60],
];

// PO 11743 / RWP — line totals per PO
const RWP_PO_TOTALS = [
  ["S101100", 7393.85],
  ["S101600", 4678.20],
  ["S121145", 574.75],
  ["S121645", 923.32],
  ["S301611", 428.26],
  ["S301111", 304.42],
  ["S661140", 643.77],
  ["S151611", 180.81],
  ["S231620", 617.76],
  ["S411195", 1156.00],
  ["S411695", 1759.04],
  ["S231120", 867.89],
  ["S421150", 244.28],
  ["S251111", 35.21],
  ["SP302B/SS302B", 27.72],
  ["S421120", 226.80],
  ["S701178", 159.30],
  ["S301616", 563.50],
  ["S111196", 88.83],
  ["S201616", 73.53],
  ["S111691", 37.77],
  ["S100900", 25.18],
  ["S410995", 15.10],
  ["S421620", 235.20],
  ["S701678", 53.85],
];

async function main() {
  // Fetch all ticket lines once for lookup
  const allTLs = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    orderBy: { displayOrder: "asc" },
  });
  const bySection = (lbl) => allTLs.filter((l) => l.sectionLabel === lbl);

  async function applyPoTotals(sectionLabel, poRows) {
    const tls = bySection(sectionLabel);
    if (tls.length !== poRows.length) {
      throw new Error(`${sectionLabel}: TicketLine count ${tls.length} != PO line count ${poRows.length}`);
    }
    for (let i = 0; i < tls.length; i++) {
      const tl = tls[i];
      const [code, total] = poRows[i];
      if (tl.productCode !== code) {
        throw new Error(`${sectionLabel}#${i} productCode mismatch: TL=${tl.productCode} PO=${code}`);
      }
      // Update TicketLine total
      await prisma.ticketLine.update({
        where: { id: tl.id },
        data: { actualSaleTotal: total },
      });
      // Update matching QuoteLine total
      const ql = await prisma.quoteLine.findFirst({ where: { ticketLineId: tl.id } });
      if (ql) {
        await prisma.quoteLine.update({
          where: { id: ql.id },
          data: { lineTotal: total },
        });
      }
    }
  }

  await applyPoTotals(SVP_LABEL, SVP_PO_TOTALS);
  await applyPoTotals(RWP_LABEL, RWP_PO_TOTALS);

  // Update Quote.totalSell for each section
  const svpTotal = SVP_PO_TOTALS.reduce((s, [, t]) => s + t, 0);
  const rwpTotal = RWP_PO_TOTALS.reduce((s, [, t]) => s + t, 0);

  const svpQuote = await prisma.quote.findFirst({
    where: { ticketId: TICKET_ID, lines: { some: { sectionLabel: SVP_LABEL } } },
    orderBy: { createdAt: "asc" },
  });
  const rwpQuote = await prisma.quote.findFirst({
    where: { ticketId: TICKET_ID, lines: { some: { sectionLabel: RWP_LABEL } } },
    orderBy: { createdAt: "asc" },
  });

  await prisma.quote.update({ where: { id: svpQuote.id }, data: { totalSell: svpTotal } });
  await prisma.quote.update({ where: { id: rwpQuote.id }, data: { totalSell: rwpTotal } });
  console.log(`Quote totals updated: SVP £${svpTotal.toFixed(2)}  RWP £${rwpTotal.toFixed(2)}`);

  // Create CustomerPO records (one per Quote)
  const poDate = new Date("2026-05-12T00:00:00Z");
  async function upsertCustomerPO(poNo, quoteId, totalValue, sectionLabel, sourceFile) {
    const existing = await prisma.customerPO.findFirst({ where: { poNo } });
    if (existing) {
      console.log(`CustomerPO ${poNo} already exists (id=${existing.id}) — skipping create`);
      return existing;
    }
    return prisma.customerPO.create({
      data: {
        poNo,
        poType: "STANDARD_FIXED",
        poDate,
        status: "RECEIVED",
        customerId: CUSTOMER_ID,
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        ticketId: TICKET_ID,
        quoteId,
        totalValue,
        poLimitValue: totalValue,
        poRemainingValue: totalValue,
        vatRate: 20,
        sourceAttachmentRef: sourceFile,
        notes: `Criterion Developments — Haymarket — ${sectionLabel}. Net £${totalValue.toFixed(2)}.`,
      },
    });
  }
  const svpPO = await upsertCustomerPO("11739", svpQuote.id, svpTotal, "SVP — Soil & Vent (Akatherm HDPE)", "PurchaseOrderConstruction_1_18538_11739.pdf");
  const rwpPO = await upsertCustomerPO("11743", rwpQuote.id, rwpTotal, "RWP — Rainwater (Akatherm HDPE)", "PurchaseOrderConstruction_1_18538_11743.pdf");
  console.log(`CustomerPO 11739 (SVP) → id=${svpPO.id}`);
  console.log(`CustomerPO 11743 (RWP) → id=${rwpPO.id}`);

  // Auto DealSheet per Quote — matches /api/tickets/[id]/quotes route logic
  async function makeDealSheet(quoteId, sectionLabel) {
    const last = await prisma.dealSheet.findFirst({
      where: { ticketId: TICKET_ID },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });
    const version = (last?.versionNo ?? 0) + 1;

    const tls = bySection(sectionLabel);
    let totalExpectedCost = 0;
    let totalExpectedSell = 0;
    const lineSnapshots = tls.map((line) => {
      const costUnit = Number(line.expectedCostUnit ?? 0);
      const sellUnit = Number(line.actualSaleUnit ?? line.suggestedSaleUnit ?? 0);
      const qty = Number(line.qty);
      totalExpectedCost += costUnit * qty;
      totalExpectedSell += sellUnit * qty;
      return {
        ticketLineId: line.id,
        versionNo: version,
        supplierSourceSummary: line.supplierName || null,
        benchmarkUnit: line.benchmarkUnit ?? null,
        expectedCostUnit: costUnit,
        suggestedSaleUnit: sellUnit,
        actualSaleUnit: line.actualSaleUnit ?? null,
        expectedMarginUnit: sellUnit - costUnit,
      };
    });
    const ds = await prisma.dealSheet.create({
      data: {
        ticketId: TICKET_ID,
        versionNo: version,
        mode: "STANDARD",
        status: "DRAFT",
        totalExpectedCost,
        totalExpectedSell,
        totalExpectedMargin: totalExpectedSell - totalExpectedCost,
        lineSnapshots: { create: lineSnapshots },
      },
    });
    return ds;
  }
  const svpDS = await makeDealSheet(svpQuote.id, SVP_LABEL);
  const rwpDS = await makeDealSheet(rwpQuote.id, RWP_LABEL);
  console.log(`DealSheet SVP v${svpDS.versionNo} (id=${svpDS.id})`);
  console.log(`DealSheet RWP v${rwpDS.versionNo} (id=${rwpDS.id})`);

  // Promote Ticket to QUOTED
  await prisma.ticket.update({
    where: { id: TICKET_ID },
    data: { status: "QUOTED", quoteStatus: "DRAFT", quotedAt: new Date() },
  });
  console.log(`Ticket ${TICKET_ID} → status=QUOTED`);

  await prisma.event.create({
    data: {
      ticketId: TICKET_ID,
      eventType: "QUOTE_REQUESTED",
      timestamp: new Date(),
      notes: `Two quotes raised for Criterion Developments @ Haymarket (SVP + RWP), customer POs 11739 + 11743 received and linked.`,
    },
  });

  // Re-generate proformas — same PF numbers, new totals, new PO numbers shown
  const validUntil = new Date("2026-06-11T00:00:00Z");
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
  console.log(`Proforma SVP: ${svpPf.proformaNumber}  net £${svpPf.totalSale}  →  ${svpPf.path}`);
  console.log(`Proforma RWP: ${rwpPf.proformaNumber}  net £${rwpPf.totalSale}  →  ${rwpPf.path}`);

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

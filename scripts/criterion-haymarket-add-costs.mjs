#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "e86ce26e-7d16-4885-8771-c50ff70a29cb";
const MARGIN_PCT = 0.08;
const COST_FACTOR = 1 - MARGIN_PCT; // 0.92

// Not Akatherm HDPE — costed separately, excluded from the 8% margin rule.
const EXCLUDED_CODES = new Set(["AAV110", "SP302B/SS302B"]);

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

async function main() {
  const lines = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    orderBy: { displayOrder: "asc" },
  });

  let priced = 0, skipped = 0;
  let totalSale = 0, totalCost = 0, excludedSale = 0;
  for (const tl of lines) {
    const saleUnit = Number(tl.actualSaleUnit ?? 0);
    const saleTotal = Number(tl.actualSaleTotal ?? 0);
    if (EXCLUDED_CODES.has(tl.productCode ?? "")) {
      excludedSale += saleTotal;
      skipped++;
      continue;
    }
    const costUnit = round4(saleUnit * COST_FACTOR);
    const costTotal = round2(saleTotal * COST_FACTOR);
    const marginTotal = round2(saleTotal - costTotal);
    await prisma.ticketLine.update({
      where: { id: tl.id },
      data: {
        expectedCostUnit: costUnit,
        expectedCostTotal: costTotal,
        expectedMarginTotal: marginTotal,
      },
    });
    totalSale += saleTotal;
    totalCost += costTotal;
    priced++;
  }
  const totalMargin = round2(totalSale - totalCost);
  console.log(`TicketLines: ${priced} priced @ 8% margin, ${skipped} excluded (Durgo + Vent Cowl)`);
  console.log(`  Akatherm sale £${totalSale.toFixed(2)}  cost £${totalCost.toFixed(2)}  margin £${totalMargin.toFixed(2)} (${((totalMargin/totalSale)*100).toFixed(2)}%)`);
  console.log(`  Excluded (cost TBC) sale £${excludedSale.toFixed(2)}`);

  // Refresh DealSheet line snapshots + headers
  const dealSheets = await prisma.dealSheet.findMany({
    where: { ticketId: TICKET_ID },
    include: { lineSnapshots: { include: { ticketLine: { select: { id: true, actualSaleUnit: true, actualSaleTotal: true, qty: true, expectedCostUnit: true, expectedCostTotal: true } } } } },
    orderBy: { versionNo: "asc" },
  });

  for (const ds of dealSheets) {
    let dsExpCost = 0;
    let dsExpSell = 0;
    for (const snap of ds.lineSnapshots) {
      const tl = snap.ticketLine;
      if (!tl) continue;
      const sellUnit = Number(tl.actualSaleUnit ?? 0);
      const costUnit = Number(tl.expectedCostUnit ?? 0);
      // Use *Total fields as the source of truth so DealSheet ties to Quote/PO.
      dsExpSell += Number(tl.actualSaleTotal ?? 0);
      dsExpCost += Number(tl.expectedCostTotal ?? 0);
      await prisma.dealSheetLineSnapshot.update({
        where: { id: snap.id },
        data: {
          expectedCostUnit: costUnit,
          expectedMarginUnit: round4(sellUnit - costUnit),
        },
      });
    }
    dsExpSell = round2(dsExpSell);
    dsExpCost = round2(dsExpCost);
    const dsMargin = round2(dsExpSell - dsExpCost);
    await prisma.dealSheet.update({
      where: { id: ds.id },
      data: {
        totalExpectedSell: dsExpSell,
        totalExpectedCost: dsExpCost,
        totalExpectedMargin: dsMargin,
      },
    });
    console.log(`  DealSheet v${ds.versionNo}: sell £${dsExpSell.toFixed(2)} / cost £${dsExpCost.toFixed(2)} / margin £${dsMargin.toFixed(2)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

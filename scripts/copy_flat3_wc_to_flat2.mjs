#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "914d46fb-7884-4a8b-82e0-afb4622af2ee";
const SOURCE_SECTION = "FLAT 3 - W/C";
const NEW_SECTION = "FLAT 2 - W/C";
const PREV_SECTION = "FLAT 2 - EN-SUITE";
const NEXT_SECTION = "FLAT 3 - MAIN BATHROOM";

async function main() {
  // 1. Pull all source-section lines, ordered.
  const src = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID, sectionLabel: SOURCE_SECTION },
    orderBy: { displayOrder: "asc" },
  });
  if (src.length === 0) throw new Error(`No lines in source section '${SOURCE_SECTION}'`);

  // 2. Find insertion boundary.
  const prevMax = await prisma.ticketLine.aggregate({
    where: { ticketId: TICKET_ID, sectionLabel: PREV_SECTION },
    _max: { displayOrder: true },
  });
  const nextMin = await prisma.ticketLine.aggregate({
    where: { ticketId: TICKET_ID, sectionLabel: NEXT_SECTION },
    _min: { displayOrder: true },
  });
  const prevMaxOrder = prevMax._max.displayOrder;
  const nextMinOrder = nextMin._min.displayOrder;
  if (prevMaxOrder == null) throw new Error(`No lines in '${PREV_SECTION}'`);
  if (nextMinOrder == null) throw new Error(`No lines in '${NEXT_SECTION}'`);
  if (nextMinOrder !== prevMaxOrder + 1) {
    console.warn(`WARN: gap between sections — PREV max=${prevMaxOrder}, NEXT min=${nextMinOrder}`);
  }

  console.log(`Source lines: ${src.length}`);
  console.log(`Insert range: displayOrder ${prevMaxOrder + 1}..${prevMaxOrder + src.length}`);
  console.log(`Will shift displayOrder of all lines >= ${nextMinOrder} by +${src.length}`);

  const insertStart = prevMaxOrder + 1;
  const shift = src.length;

  // 3. Do everything in a transaction.
  await prisma.$transaction(
    async (tx) => {
      // 3a. Shift downstream lines DOWN in two passes via a large offset so unique-ish ordering stays stable.
      //     Use a high offset (10_000_000) to push them out of the way, then assign final values.
      const OFFSET = 10_000_000;
      await tx.ticketLine.updateMany({
        where: { ticketId: TICKET_ID, displayOrder: { gte: nextMinOrder } },
        data: { displayOrder: { increment: OFFSET + shift } },
      });
      await tx.ticketLine.updateMany({
        where: { ticketId: TICKET_ID, displayOrder: { gte: OFFSET + nextMinOrder + shift } },
        data: { displayOrder: { decrement: OFFSET } },
      });

      // 3b. Create new lines. Two-pass to preserve BOM parent/child mapping.
      const idMap = new Map(); // oldId -> newId

      // First pass: BOM parents and standalone lines (parentLineId == null).
      for (let i = 0; i < src.length; i++) {
        const o = src[i];
        if (o.parentLineId != null) continue;
        const created = await tx.ticketLine.create({
          data: copyData(o, insertStart + i, NEW_SECTION, null),
        });
        idMap.set(o.id, created.id);
      }

      // Second pass: BOM components (parentLineId != null). Maintain original displayOrder positions.
      for (let i = 0; i < src.length; i++) {
        const o = src[i];
        if (o.parentLineId == null) continue;
        const newParentId = idMap.get(o.parentLineId);
        if (!newParentId) {
          throw new Error(
            `BOM child #${o.displayOrder} (${o.id}) references parent ${o.parentLineId} not found in source section`,
          );
        }
        const created = await tx.ticketLine.create({
          data: copyData(o, insertStart + i, NEW_SECTION, newParentId),
        });
        idMap.set(o.id, created.id);
      }

      console.log(`Created ${idMap.size} new lines in section '${NEW_SECTION}'`);
    },
    { timeout: 120_000 },
  );

  // 4. Verify.
  const verify = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID, sectionLabel: NEW_SECTION },
    orderBy: { displayOrder: "asc" },
    select: { displayOrder: true, description: true, isBomParent: true, parentLineId: true },
  });
  console.log(`\nVerify: section '${NEW_SECTION}' has ${verify.length} lines`);
  for (const v of verify) {
    console.log(`  #${String(v.displayOrder).padStart(3)} bom=${v.isBomParent ? "Y" : "n"} child=${v.parentLineId ? "Y" : "n"} | ${v.description.slice(0, 70)}`);
  }
}

function copyData(o, displayOrder, sectionLabel, parentLineId) {
  return {
    ticketId: o.ticketId,
    ticketPhaseId: o.ticketPhaseId,
    displayOrder,
    lineType: o.lineType,
    description: o.description,
    normalizedItemName: o.normalizedItemName,
    productCode: o.productCode,
    specification: o.specification,
    internalNotes: o.internalNotes,
    qty: o.qty,
    unit: o.unit,
    siteId: o.siteId,
    siteCommercialLinkId: o.siteCommercialLinkId,
    payingCustomerId: o.payingCustomerId,
    requestedByContactId: o.requestedByContactId,
    supplierStrategyType: o.supplierStrategyType,
    supplierId: o.supplierId,
    supplierName: o.supplierName,
    supplierReference: o.supplierReference,
    status: o.status,
    expectedCostUnit: o.expectedCostUnit,
    expectedCostTotal: o.expectedCostTotal,
    actualCostTotal: o.actualCostTotal,
    benchmarkUnit: o.benchmarkUnit,
    benchmarkTotal: o.benchmarkTotal,
    suggestedSaleUnit: o.suggestedSaleUnit,
    actualSaleUnit: o.actualSaleUnit,
    actualSaleTotal: o.actualSaleTotal,
    expectedMarginTotal: o.expectedMarginTotal,
    actualMarginTotal: o.actualMarginTotal,
    varianceTotal: o.varianceTotal,
    evidenceStatus: o.evidenceStatus,
    costStatus: o.costStatus,
    salesStatus: o.salesStatus,
    mergedIntoLineId: o.mergedIntoLineId,
    sourceItemIds: o.sourceItemIds,
    fromStock: o.fromStock,
    toOrder: o.toOrder,
    isLocked: o.isLocked,
    priceOverride: o.priceOverride,
    deliveryCostShare: o.deliveryCostShare,
    sectionLabel,
    canonicalProductId: o.canonicalProductId,
    parentLineId,
    isBomParent: o.isBomParent,
  };
}

main().finally(() => prisma.$disconnect());

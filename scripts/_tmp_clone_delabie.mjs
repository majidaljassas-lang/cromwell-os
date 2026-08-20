import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SRC = '07d0db56-0bf9-491a-9d73-9c8e40b04a37';
const NEW_TITLE = 'Delabie x 100 - PRE JULY 2026';

const src = await prisma.ticket.findUnique({
  where: { id: SRC },
  include: { lines: { orderBy: { displayOrder: 'asc' } } },
});

const result = await prisma.$transaction(async (tx) => {
  const t = await tx.ticket.create({
    data: {
      title: NEW_TITLE,
      description: src.description,
      parentJobId: src.parentJobId,
      siteId: src.siteId,
      siteCommercialLinkId: src.siteCommercialLinkId,
      payingCustomerId: src.payingCustomerId,
      requestedByContactId: src.requestedByContactId,
      actingOnBehalfOfContactId: src.actingOnBehalfOfContactId,
      ticketMode: src.ticketMode,
      scopeType: src.scopeType,
      status: src.status,
      quoteRequired: src.quoteRequired,
      quoteStatus: src.quoteStatus,
      poRequired: src.poRequired,
      poStatus: src.poStatus,
      recoveryRequired: src.recoveryRequired,
      source: src.source,
      sourceRef: src.sourceRef,
      revenueState: src.revenueState,
      deliveryBillingMode: src.deliveryBillingMode,
    },
  });

  for (const l of src.lines) {
    await tx.ticketLine.create({
      data: {
        ticketId: t.id,
        displayOrder: l.displayOrder,
        lineType: l.lineType,
        description: l.description,
        normalizedItemName: l.normalizedItemName,
        productCode: l.productCode,
        specification: l.specification,
        internalNotes: l.internalNotes,
        qty: l.qty,
        unit: l.unit,
        siteId: l.siteId,
        siteCommercialLinkId: l.siteCommercialLinkId,
        payingCustomerId: l.payingCustomerId,
        requestedByContactId: l.requestedByContactId,
        supplierStrategyType: l.supplierStrategyType,
        supplierId: l.supplierId,
        supplierName: l.supplierName,
        supplierReference: l.supplierReference,
        status: l.status,
        expectedCostUnit: l.expectedCostUnit,
        expectedCostTotal: l.expectedCostTotal,
        benchmarkUnit: l.benchmarkUnit,
        benchmarkTotal: l.benchmarkTotal,
        suggestedSaleUnit: l.suggestedSaleUnit,
        actualSaleUnit: l.actualSaleUnit,
        actualSaleTotal: l.actualSaleTotal,
        expectedMarginTotal: l.expectedMarginTotal,
        actualMarginTotal: l.actualMarginTotal,
        varianceTotal: l.varianceTotal,
        sectionLabel: l.sectionLabel,
        priceOverride: l.priceOverride,
        sourceItemIds: [],
      },
    });
  }
  return t;
});

const clone = await prisma.ticket.findUnique({
  where: { id: result.id },
  select: { id: true, ticketNo: true, title: true, status: true, ticketMode: true, _count: { select: { lines: true } } },
});
console.log("CLONED:", JSON.stringify(clone, null, 2));
await prisma.$disconnect();

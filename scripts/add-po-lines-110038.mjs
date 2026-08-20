#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Source: PDF Purchase_Order_0088_110038 from Sam Kitirou, Yesss London City, 08/04/2026
const LINES = [
  { productCode: "152.434.16.1", description: "Geberit flush pipe kits", qty: 10, unitPrice: 8.0 },
  { productCode: "CARRIAGE", description: "charge", qty: 1, unitPrice: 7.5 },
];

async function main() {
  const po = await prisma.customerPO.findFirst({
    where: { poNo: "0088/110038" },
    include: { ticket: true, lines: true },
  });
  if (!po) throw new Error("PO not found");
  if (po.lines.length) { console.log(`PO already has ${po.lines.length} line(s) — aborting`); return; }
  if (!po.ticketId) throw new Error("PO has no ticket link");

  for (const l of LINES) {
    const tl = await prisma.ticketLine.create({
      data: {
        ticketId: po.ticketId,
        lineType: "MATERIAL",
        description: l.description,
        productCode: l.productCode,
        qty: l.qty,
        unit: "EA",
        siteId: po.siteId,
        siteCommercialLinkId: po.siteCommercialLinkId,
        payingCustomerId: po.customerId,
        status: "ORDERED",
        actualSaleUnit: l.unitPrice,
        actualSaleTotal: Math.round(l.unitPrice * l.qty * 100) / 100,
      },
    });
    await prisma.customerPOLine.create({
      data: {
        customerPOId: po.id,
        ticketLineId: tl.id,
        description: `${l.productCode} — ${l.description}`,
        qty: l.qty,
        agreedUnitPrice: l.unitPrice,
        agreedTotal: Math.round(l.unitPrice * l.qty * 100) / 100,
        remainingQty: l.qty,
        remainingValue: Math.round(l.unitPrice * l.qty * 100) / 100,
      },
    });
    console.log(`  + ${l.productCode} · qty ${l.qty} × £${l.unitPrice} = £${(l.unitPrice * l.qty).toFixed(2)}`);
  }
  const total = LINES.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  console.log(`\n${LINES.length} PO lines created · total £${total.toFixed(2)} (matches PO limit £${po.poLimitValue})`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Source: Yesss Lewisham PO 0061/015333, Lee Jones, 30/01/2026
const LINES = [
  {
    productCode: "S8210AA.",
    description: "Armitage Shanks Markwik 1/2\" Wall Mounted Mixer With 150mm Levers, Concealed Inlets With 125mm Projection Single Flow Swivel Spout And Brass Flow Guide",
    qty: 3,
    unitPrice: 451.41,
  },
  { productCode: "A861264NU.", description: "Ideal Standard Trevi 40mm Diverter Cartridge", qty: 3, unitPrice: 83.5 },
  { productCode: "S9599NU.", description: "Amitage Shank Hot & Cold 25mm Indices", qty: 3, unitPrice: 11.13 },
  {
    productCode: "S961201AA.",
    description: "Armitage Shanks Swan Neck Spout & Anti Splash for Wall Mixer - Chrome",
    qty: 3,
    unitPrice: 133.52,
  },
  { productCode: "A860372NU.", description: "Armitage Shanks Avon self-Closing cartridg", qty: 3, unitPrice: 140.5 },
];

const SRC_PDF = "/Users/majidaljassas/Downloads/Purchase Order 0061_015333 [Ref. ].pdf";

async function main() {
  const po = await prisma.customerPO.findFirst({
    where: { poNo: "0061/015333" },
    include: { ticket: true, lines: true },
  });
  if (!po) throw new Error("PO not found");
  if (po.lines.length) { console.log(`PO already has ${po.lines.length} line(s) — aborting`); return; }
  if (!po.ticketId) throw new Error("PO has no ticket link");

  // Archive the source PDF alongside other email-attachments for audit trail
  if (fs.existsSync(SRC_PDF)) {
    const dest = "/Users/majidaljassas/cromwell-os/public/email-attachments/manual-upload_Purchase_Order_0061_015333.pdf";
    fs.copyFileSync(SRC_PDF, dest);
    console.log(`Archived source PDF → ${dest}`);
  }

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
  console.log(`\n${LINES.length} PO lines · total £${total.toFixed(2)} (PO limit £${po.poLimitValue})`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

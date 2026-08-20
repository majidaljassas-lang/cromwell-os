#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import { createRequire } from "node:module";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PO_NO = "PO2594";
const PDF_PATH = "/Users/majidaljassas/cromwell-os/public/email-attachments/d40ed1bb_PO2594_Cromwell.pdf";

async function main() {
  const { parsePOWithAI } = await import("../src/lib/ingestion/ai-po-parser.ts");

  const po = await prisma.customerPO.findFirst({
    where: { poNo: PO_NO },
    include: { ticket: true, lines: true },
  });
  if (!po) throw new Error(`PO ${PO_NO} not found`);
  if (po.lines.length) { console.log(`PO has ${po.lines.length} line(s) — skipping`); return; }
  if (!po.ticketId) throw new Error("PO has no ticket link");

  const buf = fs.readFileSync(PDF_PATH);
  const { text } = await pdfParse(buf);
  const parsed = await parsePOWithAI(text);
  if (!parsed) throw new Error("AI parser returned null");
  console.log(`AI parser result: ${parsed.lines.length} lines, confidence=${parsed.confidence}`);

  const lineSum = parsed.lines.reduce((s, l) => s + l.lineTotal, 0);
  if (Math.abs(lineSum - Number(po.poLimitValue ?? 0)) > 0.05) {
    throw new Error(`Sum mismatch: £${lineSum.toFixed(2)} vs PO limit £${po.poLimitValue}`);
  }

  for (const pl of parsed.lines) {
    const tl = await prisma.ticketLine.create({
      data: {
        ticketId: po.ticketId,
        lineType: "MATERIAL",
        description: pl.description,
        productCode: pl.productCode || null,
        qty: pl.qty,
        unit: "EA",
        siteId: po.siteId,
        siteCommercialLinkId: po.siteCommercialLinkId,
        payingCustomerId: po.customerId,
        status: "ORDERED",
        actualSaleUnit: pl.unitPrice,
        actualSaleTotal: Math.round(pl.unitPrice * pl.qty * 100) / 100,
      },
    });
    await prisma.customerPOLine.create({
      data: {
        customerPOId: po.id,
        ticketLineId: tl.id,
        description: pl.productCode ? `${pl.productCode} — ${pl.description}` : pl.description,
        qty: pl.qty,
        agreedUnitPrice: pl.unitPrice,
        agreedTotal: Math.round(pl.unitPrice * pl.qty * 100) / 100,
        remainingQty: pl.qty,
        remainingValue: Math.round(pl.unitPrice * pl.qty * 100) / 100,
      },
    });
    console.log(`  + ${pl.productCode || "<no code>"} · qty ${pl.qty} × £${pl.unitPrice} = £${pl.lineTotal.toFixed(2)}`);
  }

  // Backfill header fields
  await prisma.customerPO.update({
    where: { id: po.id },
    data: {
      poDate: po.poDate ?? (parsed.poDate ? new Date(parsed.poDate) : null),
      issuedBy: po.issuedBy || parsed.issuer || "Jonathan Hugill",
    },
  });

  console.log(`\n${parsed.lines.length} PO lines created on ${PO_NO}. Total £${lineSum.toFixed(2)}.`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
/**
 * Backfill PO lines for any CustomerPO that was auto-created as a shell
 * (poLimitValue set but zero CustomerPOLine rows) before the Yesss template
 * parser was wired into the ingestion pipeline.
 *
 * For each eligible PO:
 *  1. Walk the email-attachments folder for a PDF whose filename contains
 *     the PO number (or one of its slug variants).
 *  2. Run the Yesss parser.
 *  3. If it returns lines AND the sum matches the PO limit (within 1p),
 *     create matching TicketLine + CustomerPOLine rows.
 *  4. Skip silently on any mismatch — safer to leave a stub than to invent
 *     wrong data.
 *
 * Idempotent: reruns are safe because we only touch POs with zero lines.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse");

// We import the compiled parser via tsx's require-transform. Easier: duplicate
// the entrypoint call by executing tsx-run here.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const ATTACH_DIR = path.join(process.cwd(), "public", "email-attachments");

async function loadParser() {
  // Dynamic import with tsx handles TS. This file runs under tsx.
  const mod = await import("../src/lib/ingestion/yesss-po-parser.ts");
  return mod.parseYesssPoText;
}

function slugVariants(poNo) {
  // Match filename conventions: "0088/110204" → ["0088_110204", "0088/110204"]
  return [poNo, poNo.replace(/\//g, "_")];
}

async function findPdfForPo(poNo) {
  if (!fs.existsSync(ATTACH_DIR)) return null;
  const variants = slugVariants(poNo);
  const files = fs.readdirSync(ATTACH_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
  for (const f of files) {
    if (variants.some((v) => f.includes(v))) return path.join(ATTACH_DIR, f);
  }
  return null;
}

async function main() {
  const parse = await loadParser();
  const stubPos = await prisma.customerPO.findMany({
    where: { lines: { none: {} } },
    include: { ticket: { select: { id: true, ticketNo: true } } },
  });
  console.log(`Found ${stubPos.length} PO(s) with zero lines`);

  let filled = 0;
  let skipped = 0;
  for (const po of stubPos) {
    const pdfPath = await findPdfForPo(po.poNo);
    if (!pdfPath) { console.log(`  [skip] ${po.poNo} — no PDF on disk`); skipped++; continue; }

    const buf = fs.readFileSync(pdfPath);
    const { text } = await pdfParse(buf);
    const parsed = parse(text);
    if (!parsed) { console.log(`  [skip] ${po.poNo} — not a Yesss template (or parse failed)`); skipped++; continue; }
    if (parsed.direction === "OUTBOUND_REFLECTION") { console.log(`  [skip] ${po.poNo} — outbound reflection`); skipped++; continue; }

    const lineTotal = parsed.lines.reduce((s, l) => s + l.lineTotal, 0);
    const limit = Number(po.poLimitValue ?? 0);
    if (limit > 0 && Math.abs(lineTotal - limit) > 0.01) {
      console.log(`  [skip] ${po.poNo} — sum £${lineTotal.toFixed(2)} != PO limit £${limit.toFixed(2)}`);
      skipped++;
      continue;
    }

    if (!po.ticketId) { console.log(`  [skip] ${po.poNo} — no ticket linked, manual review needed`); skipped++; continue; }

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
    }

    // Backfill header fields if still empty
    await prisma.customerPO.update({
      where: { id: po.id },
      data: {
        poLimitValue: limit || parsed.totalExVat,
        poDate: po.poDate ?? (parsed.poDate ? new Date(parsed.poDate) : null),
        issuedBy: po.issuedBy || parsed.issuer,
      },
    });

    console.log(`  [ok]   ${po.poNo} · T-${po.ticket?.ticketNo} · ${parsed.lines.length} lines £${lineTotal.toFixed(2)}`);
    filled++;
  }

  console.log(`\nFilled ${filled} PO(s), skipped ${skipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

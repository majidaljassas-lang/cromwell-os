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
const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb";
const SITE_ID = "a5b5cb59-9e0a-4f70-9741-1bc3d8cb57c1";
const SCL_ID = "df6fadf7-d0fa-438a-9b88-761481c7a6ab";

const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  // 1. Create new RWP Ticket (no resync — only TicketLine ops trigger resync)
  const rwpTicket = await prisma.ticket.create({
    data: {
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      payingCustomerId: CUSTOMER_ID,
      title: "Criterion — Haymarket — HDPE RWP Above-Ground Supply",
      description: "RWP (Rainwater) — Akatherm HDPE. Material supply for above-ground drainage.",
      ticketMode: "PRICING_FIRST",
      status: "QUOTED",
      quoteRequired: true,
      quoteStatus: "DRAFT",
      quotedAt: new Date(),
      source: "OTHER",
      sourceRef: "price_comparison.xlsx (split from #177 on 2026-05-13)",
    },
  });
  console.log(`New RWP Ticket: ${rwpTicket.id} (#${rwpTicket.ticketNo})`);

  // Locate Quote IDs & DealSheet IDs by section before moves
  const svpQuote = await prisma.quote.findFirst({ where: { ticketId: SVP_TICKET_ID, quoteNo: { contains: "SVP" } } });
  const rwpQuote = await prisma.quote.findFirst({ where: { ticketId: SVP_TICKET_ID, quoteNo: { contains: "RWP" } } });
  const dealSheets = await prisma.dealSheet.findMany({ where: { ticketId: SVP_TICKET_ID }, orderBy: { versionNo: "asc" } });
  // v1 = SVP, v2 = RWP per the order they were created
  const svpDS = dealSheets[0];
  const rwpDS = dealSheets[1];
  if (!svpQuote || !rwpQuote || !svpDS || !rwpDS) throw new Error("missing quote/dealsheet refs");

  // 2. Raw SQL moves (bypass ticket-line-sync extension)
  await prisma.$executeRawUnsafe(
    `UPDATE "TicketLine" SET "ticketId" = $1 WHERE "ticketId" = $2 AND "sectionLabel" LIKE 'RWP%'`,
    rwpTicket.id, SVP_TICKET_ID,
  );
  await prisma.$executeRawUnsafe(`UPDATE "Quote" SET "ticketId" = $1 WHERE id = $2`, rwpTicket.id, rwpQuote.id);
  await prisma.$executeRawUnsafe(`UPDATE "CustomerPO" SET "ticketId" = $1 WHERE "poNo" = '11743'`, rwpTicket.id);
  await prisma.$executeRawUnsafe(
    `UPDATE "DealSheet" SET "ticketId" = $1, "versionNo" = 1 WHERE id = $2`,
    rwpTicket.id, rwpDS.id,
  );
  console.log("Moved RWP lines/quote/PO/dealsheet → new ticket");

  // 3. Round actualSaleUnit to 2dp on all 48 lines (both tickets)
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "TicketLine" SET "actualSaleUnit" = ROUND("actualSaleUnit"::numeric, 2)
     WHERE "ticketId" IN ($1, $2)`,
    SVP_TICKET_ID, rwpTicket.id,
  );
  console.log(`Rounded actualSaleUnit to 2dp on ${updated} rows`);

  // 4. Update Ticket #177 title to indicate SVP-only
  await prisma.ticket.update({
    where: { id: SVP_TICKET_ID },
    data: { title: "Criterion — Haymarket — HDPE SVP Above-Ground Supply" },
  });

  // 5. Rebuild QuoteLines per Quote (DELETE then INSERT — bypasses any trigger)
  async function rebuildQuoteLines(quoteId, ticketId) {
    const tls = await prisma.ticketLine.findMany({
      where: { ticketId },
      orderBy: { displayOrder: "asc" },
    });
    await prisma.$executeRawUnsafe(`DELETE FROM "QuoteLine" WHERE "quoteId" = $1`, quoteId);
    let total = 0;
    for (let i = 0; i < tls.length; i++) {
      const tl = tls[i];
      const unit = Number(tl.actualSaleUnit ?? 0);
      const qty = Number(tl.qty);
      const lineTotal = round2(unit * qty);
      const description = tl.productCode ? `${tl.productCode} — ${tl.description}` : tl.description;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "QuoteLine" (id, "quoteId", "ticketLineId", description, "sectionLabel", "sortOrder", qty, "unitPrice", "lineTotal")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)`,
        quoteId, tl.id, description, tl.sectionLabel, tl.displayOrder, qty, unit, lineTotal,
      );
      total += lineTotal;
    }
    total = round2(total);
    await prisma.quote.update({ where: { id: quoteId }, data: { totalSell: total } });
    return { lineCount: tls.length, total };
  }

  const svpRes = await rebuildQuoteLines(svpQuote.id, SVP_TICKET_ID);
  const rwpRes = await rebuildQuoteLines(rwpQuote.id, rwpTicket.id);
  console.log(`Quote SVP rebuilt: ${svpRes.lineCount} lines, total £${svpRes.total.toFixed(2)}`);
  console.log(`Quote RWP rebuilt: ${rwpRes.lineCount} lines, total £${rwpRes.total.toFixed(2)}`);

  // Sanity check vs PO totals
  if (svpRes.total !== 60166.97) console.warn(`!! SVP total ${svpRes.total} != PO 60166.97`);
  if (rwpRes.total !== 21314.34) console.warn(`!! RWP total ${rwpRes.total} != PO 21314.34`);

  // 7. Re-generate Pro-Formas
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
  const svpPf = await genProforma(svpQuote.id);
  const rwpPf = await genProforma(rwpQuote.id);
  console.log(`Proforma SVP: ${svpPf.proformaNumber}  net £${svpPf.totalSale}  →  ${svpPf.path}`);
  console.log(`Proforma RWP: ${rwpPf.proformaNumber}  net £${rwpPf.totalSale}  →  ${rwpPf.path}`);

  // 8. Copy PDFs to ~/Downloads
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

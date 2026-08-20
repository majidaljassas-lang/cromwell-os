#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const INVOICE_NO = "INV-004711";
const PO_NO = "0061/015333";
const ISSUED = new Date("2026-03-23T00:00:00Z");
const DUE = new Date("2026-04-30T00:00:00Z");
const TOTAL_INC_VAT = 1327.14;

// Match against TicketLine.productCode — authoritative key
const INVOICE_LINES = [
  { productCode: "A861264NU.", description: "Materials — A861264NU — Ideal Standard Trevi 40mm Diverter Cartridge", qty: 3, unitPrice: 83.5 },
  { productCode: "S9599NU.", description: "Materials — S9599NU — Armitage Shank Hot & Cold 25mm Indices", qty: 3, unitPrice: 11.13 },
  { productCode: "S961201AA.", description: "Materials — S961201AA — Armitage Shanks Swan Neck Spout & Anti Splash for Wall Mixer - Chrome", qty: 3, unitPrice: 133.52 },
  { productCode: "A860372NU.", description: "Materials — A860372NU — SELF CLOSING CARTRIDGE FOR 8012", qty: 3, unitPrice: 140.5 },
];

async function main() {
  const existing = await prisma.salesInvoice.findFirst({ where: { invoiceNo: INVOICE_NO } });
  if (existing) { console.log(`${INVOICE_NO} already exists — aborting`); return; }

  const po = await prisma.customerPO.findFirst({
    where: { poNo: PO_NO },
    include: { ticket: { include: { lines: true } }, lines: true },
  });
  if (!po) throw new Error("PO not found");

  // Resolve each invoice line to a TicketLine by productCode
  const resolved = INVOICE_LINES.map((l) => {
    const tl = po.ticket.lines.find((t) => t.productCode === l.productCode);
    if (!tl) throw new Error(`No TicketLine with productCode ${l.productCode}`);
    return { ...l, ticketLineId: tl.id };
  });

  const invoice = await prisma.salesInvoice.create({
    data: {
      ticketId: po.ticketId,
      invoiceNo: INVOICE_NO,
      customerId: po.customerId,
      siteId: po.siteId,
      siteCommercialLinkId: po.siteCommercialLinkId,
      poNo: PO_NO,
      invoiceType: "SALES",
      status: "ISSUED",
      issuedAt: ISSUED,
      dueDate: DUE,
      totalSell: TOTAL_INC_VAT,
      notes: `Zoho invoice (pre-OS). Covers 4 of 5 lines on PO ${PO_NO}. Markwik mixer S8210AA remains uninvoiced.`,
      lines: {
        create: resolved.map((l) => {
          const lineNet = Math.round(l.unitPrice * l.qty * 100) / 100;
          return {
            ticketLineId: l.ticketLineId,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: lineNet,
            vatRate: 20,
            vatAmount: Math.round(lineNet * 0.2 * 100) / 100,
            displayMode: "UNIT",
            poMatched: true,
            poMatchStatus: "MATCHED",
          };
        }),
      },
    },
    include: { lines: true },
  });

  // Update PO line consumption on the 4 invoiced lines only — leave Markwik untouched
  for (const invLine of invoice.lines) {
    const poLine = po.lines.find((pl) => pl.ticketLineId === invLine.ticketLineId);
    if (!poLine) continue;
    const consumed = Math.round(Number(invLine.lineTotal) * 100) / 100;
    await prisma.customerPOLine.update({
      where: { id: poLine.id },
      data: {
        consumedQty: invLine.qty,
        consumedValue: consumed,
        remainingQty: 0,
        remainingValue: Math.max(0, Math.round((Number(poLine.agreedTotal) - consumed) * 100) / 100),
      },
    });
  }

  // Do NOT overwrite CustomerPO.invoiceNo — the page auto-enriches by scanning
  // all SalesInvoices with matching poNo, so a future second invoice will
  // show alongside this one automatically (comma-joined in the Invoice column)

  const invoicedTotal = invoice.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
  const remainingTotal = Number(po.poLimitValue) - invoicedTotal;
  console.log(`Created ${invoice.invoiceNo} · ${invoice.lines.length} lines · net £${invoicedTotal.toFixed(2)} · inc VAT £${invoice.totalSell}`);
  console.log(`PO ${PO_NO} remaining to invoice: £${remainingTotal.toFixed(2)} (S8210AA Markwik mixer)`);

  // ─── Draft invoice INV-004829 for the Markwik backorder ───────────────────
  const DRAFT_INV_NO = "INV-004829";
  const existingDraft = await prisma.salesInvoice.findFirst({ where: { invoiceNo: DRAFT_INV_NO } });
  if (existingDraft) { console.log(`${DRAFT_INV_NO} already exists — skipping`); return; }

  const markwikLine = po.ticket.lines.find((t) => t.productCode === "S8210AA.");
  if (!markwikLine) throw new Error("Markwik TicketLine not found");
  const markwikNet = Math.round(451.41 * 3 * 100) / 100;   // 1354.23
  const markwikVat = Math.round(markwikNet * 0.2 * 100) / 100; // 270.85 (approx)
  const markwikTotalInc = Math.round((markwikNet + markwikVat) * 100) / 100;

  const draft = await prisma.salesInvoice.create({
    data: {
      ticketId: po.ticketId,
      invoiceNo: DRAFT_INV_NO,
      customerId: po.customerId,
      siteId: po.siteId,
      siteCommercialLinkId: po.siteCommercialLinkId,
      poNo: PO_NO,
      invoiceType: "SALES",
      status: "DRAFT",
      issuedAt: null,
      dueDate: null,
      totalSell: markwikTotalInc,
      notes: `Zoho draft — backorder for S8210AA Markwik mixer on PO ${PO_NO}. Not yet sent.`,
      lines: {
        create: [{
          ticketLineId: markwikLine.id,
          description: "Materials — S8210AA — Armitage Shanks Markwik 1/2\" Wall Mounted Mixer (backorder)",
          qty: 3,
          unitPrice: 451.41,
          lineTotal: markwikNet,
          vatRate: 20,
          vatAmount: markwikVat,
          displayMode: "UNIT",
          poMatched: true,
          poMatchStatus: "MATCHED",
        }],
      },
    },
    include: { lines: true },
  });

  // Allocate consumption on the Markwik PO line as "invoiced (draft)"
  const markwikPoLine = po.lines.find((pl) => pl.ticketLineId === markwikLine.id);
  if (markwikPoLine) {
    await prisma.customerPOLine.update({
      where: { id: markwikPoLine.id },
      data: {
        consumedQty: 3,
        consumedValue: markwikNet,
        remainingQty: 0,
        remainingValue: 0,
      },
    });
  }

  console.log(`Created ${draft.invoiceNo} (DRAFT) · 1 line · net £${markwikNet.toFixed(2)} · inc VAT £${markwikTotalInc.toFixed(2)}`);
  console.log(`\nPO ${PO_NO} fully invoiced: £${(invoicedTotal + markwikNet).toFixed(2)} net across 2 invoices (1 ISSUED + 1 DRAFT)`);
}

main().catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

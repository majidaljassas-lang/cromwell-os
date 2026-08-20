#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const QUOTE_NO = "Q-1776097124159";
const ISSUED_AT = new Date("2026-04-13T00:00:00Z");
const IK_SABS_ID = "fc39603f-bbc8-431d-91e0-1221e3c285c9";

const V1 = {
  subtotal: 1621.87,
  lines: [
    {
      description: "800 x 1000 Shower",
      sectionLabel: "Shower",
      qty: 1,
      unitPrice: 730.48,
      lineTotal: 730.48,
      components: [
        "CRR800X1000W Creo Rectangle Shower Tray 800 x 1000 25mm",
        "CRHFWS90_V2 Creo Shower Tray Waste 90mm",
        "1900 x 1000mm Sliding Shower Door",
        "Design Shower Set 3 with Fixed Head & Handset",
      ],
    },
    {
      description: "Wall Hung Toilet",
      sectionLabel: "Toilet",
      qty: 1,
      unitPrice: 488.72,
      lineTotal: 488.72,
      components: [
        "3852520A Grohe Rapid SL 1000mm x 500mm Installation Frame w/o Flushplate",
        "3855800M Grohe RAPID-SL Front Wall brackets; Chrome",
        "38732000 Grohe SKATE COSMOPOLITAN WC Wall Plate; Dual Flush; Chrome",
        "Freya Rimless Wall Hung Pan & SC Seat White",
      ],
    },
    {
      description: "600mm Basin",
      sectionLabel: "Basin",
      qty: 1,
      unitPrice: 402.67,
      lineTotal: 402.67,
      components: [
        "nuie Lunar 600mm 1 Drawer Satin White Wall Hung Vanity Unit With Basin",
        "DR110DNC Drift Basin Tap Chrome",
        "BSW0260C Universal Click Clack Basin Waste",
      ],
    },
  ],
};

function buildV2Lines(v1Lines, uplift) {
  const total = v1Lines.reduce((s, l) => s + l.lineTotal, 0);
  const deltas = v1Lines.map((l) => Math.round((l.lineTotal / total) * uplift * 100) / 100);
  const sumDelta = deltas.reduce((s, d) => s + d, 0);
  const rounding = Math.round((uplift - sumDelta) * 100) / 100;
  let largestIdx = 0;
  v1Lines.forEach((l, i) => { if (l.lineTotal > v1Lines[largestIdx].lineTotal) largestIdx = i; });
  deltas[largestIdx] = Math.round((deltas[largestIdx] + rounding) * 100) / 100;

  return v1Lines.map((l, i) => ({
    ...l,
    unitPrice: Math.round((l.unitPrice + deltas[i] / l.qty) * 100) / 100,
    lineTotal: Math.round((l.lineTotal + deltas[i]) * 100) / 100,
    _delta: deltas[i],
  }));
}

async function main() {
  const existing = await prisma.quote.findMany({ where: { quoteNo: QUOTE_NO } });
  if (existing.length) {
    console.log(`Quote ${QUOTE_NO} already exists (${existing.length} version(s))`);
    for (const q of existing) console.log(`  v${q.versionNo} · ${q.status} · £${q.totalSell}`);
    return;
  }

  // 1. Site — upsert by name
  let site = await prisma.site.findFirst({ where: { siteName: "6 Grebe Terrace" } });
  if (!site) {
    site = await prisma.site.create({
      data: {
        siteName: "6 Grebe Terrace",
        addressLine1: "6 Grebe Terrace",
        notes: "IK SABS — Adrian bathroom",
      },
    });
    console.log(`Created site ${site.id} (6 Grebe Terrace)`);
  } else {
    console.log(`Site exists: ${site.id}`);
  }

  // 2. SiteCommercialLink — IK SABS billing role at 6 Grebe
  let link = await prisma.siteCommercialLink.findFirst({
    where: { siteId: site.id, customerId: IK_SABS_ID, role: "BILLING" },
  });
  if (!link) {
    link = await prisma.siteCommercialLink.create({
      data: {
        siteId: site.id,
        customerId: IK_SABS_ID,
        role: "BILLING",
        billingAllowed: true,
        defaultBillingCustomer: true,
        isActive: true,
      },
    });
    console.log(`Created SiteCommercialLink ${link.id}`);
  } else {
    console.log(`SiteCommercialLink exists: ${link.id}`);
  }

  // 3. Ticket
  const ticket = await prisma.ticket.create({
    data: {
      title: "6 Grebe Terrace — Bathroom (Adrian)",
      description: "Bathroom quotation: shower, wall-hung toilet, 600mm basin. Contact: Adrian.",
      siteId: site.id,
      siteCommercialLinkId: link.id,
      payingCustomerId: IK_SABS_ID,
      ticketMode: "PRICING_FIRST",
      scopeType: "Bathroom Quotation",
      status: "QUOTED",
      quoteRequired: true,
      quoteStatus: "SENT",
      source: "OTHER",
    },
  });
  console.log(`Created ticket T-${ticket.ticketNo} (${ticket.id})`);

  // 4. TicketLines (3)
  const ticketLines = [];
  for (let i = 0; i < V1.lines.length; i++) {
    const l = V1.lines[i];
    const tl = await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        lineType: "MATERIAL",
        description: l.description,
        specification: l.components.join("\n"),
        internalNotes: `Quote section: ${l.sectionLabel}`,
        qty: l.qty,
        unit: "EA",
        siteId: site.id,
        siteCommercialLinkId: link.id,
        payingCustomerId: IK_SABS_ID,
        status: "READY_FOR_QUOTE",
        actualSaleUnit: l.unitPrice,
        actualSaleTotal: l.lineTotal,
        suggestedSaleUnit: l.unitPrice,
      },
    });
    ticketLines.push(tl);
  }
  console.log(`Created ${ticketLines.length} TicketLines`);

  // 5. Quote v1
  const v1 = await prisma.quote.create({
    data: {
      ticketId: ticket.id,
      quoteNo: QUOTE_NO,
      versionNo: 1,
      quoteType: "SALES",
      customerId: IK_SABS_ID,
      siteId: site.id,
      siteCommercialLinkId: link.id,
      status: "SENT",
      issuedAt: ISSUED_AT,
      totalSell: V1.subtotal,
      notes: "Imported from PDF Cromwell-Quote-Q-1776097124159_v1",
      lines: {
        create: V1.lines.map((l, i) => ({
          ticketLineId: ticketLines[i].id,
          description: l.description,
          sectionLabel: l.sectionLabel,
          sortOrder: i,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
      },
    },
  });
  console.log(`Created Quote v1 · totalSell £${v1.totalSell}`);

  // 6. Quote v2 — +£400 proportional
  const v2Lines = buildV2Lines(V1.lines, 400);
  const v2Subtotal = Math.round(v2Lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  const v2 = await prisma.quote.create({
    data: {
      ticketId: ticket.id,
      quoteNo: QUOTE_NO,
      versionNo: 2,
      quoteType: "SALES",
      customerId: IK_SABS_ID,
      siteId: site.id,
      siteCommercialLinkId: link.id,
      status: "DRAFT",
      issuedAt: new Date(),
      totalSell: v2Subtotal,
      notes: "v2 — £400 net uplift distributed proportionally across all lines",
      lines: {
        create: v2Lines.map((l, i) => ({
          ticketLineId: ticketLines[i].id,
          description: l.description,
          sectionLabel: l.sectionLabel,
          sortOrder: i,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
      },
    },
  });
  console.log(`Created Quote v2 · totalSell £${v2.totalSell} (v1 £${V1.subtotal} + £400 uplift)`);
  console.log(`\nv2 line breakdown:`);
  for (const l of v2Lines) {
    console.log(`  ${l.sectionLabel.padEnd(8)} £${l.lineTotal.toFixed(2)}  (+£${l._delta.toFixed(2)})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

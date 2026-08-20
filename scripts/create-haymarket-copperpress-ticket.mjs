#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TITLE = "Haymarket — Copper Press Fittings & Valves";
const CUSTOMER_ID = "9b2be5a2-71d0-450e-8460-0d708795c51a"; // WEST END (LONDON) PROPERTY LTD
const SITE_ID = "9644db39-6ab1-4724-b19e-2d9c5932ec5b"; // Haymarket
const SCL_ID = "ea7733a8-fd28-460a-af9a-f35bd648fd5b"; // West End ↔ Haymarket, Main Contractor

// Cromwell (MINE) column from the 3-way comparison sheet. Unit £ = our SALE price.
// [description, qty, saleUnit, saleTotal, internalNote]
const LINES = [
  ["15MM STRAIGHT COUPLER COPPER PRESS", 208, 0.69, 143.52, null],
  ["22MM STRAIGHT COUPLER COPPER PRESS", 208, 1.07, 222.56, null],
  ["15 x 3/4\" STR MALE CONN COPPER PRESS", 1040, 1.28, 1331.20, null],
  ["15 x 1/2\" STR MALE CONN COPPER PRESS", 1084, 1.21, 1311.64, null],
  ["22 X 15MM FITTING REDUCER COPPER PRESS", 104, 0.86, 89.44, null],
  ["15mm 90 ELBOW COPPER PRESS M-PROFILE", 7520, 0.83, 6241.60, null],
  ["22mm 90 ELBOW COPPER PRESS M-PROFILE", 6480, 1.39, 9007.20, null],
  ["15mm 90 STREET ELBOW MxF COPPER PRESS", 1040, 0.83, 863.20, null],
  ["22mm 90 STREET ELBOW MxF COPPER PRESS", 2080, 1.39, 2891.20, null],
  ["15mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 2080, 0.85, 1768.00, null],
  ["22mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 3120, 1.39, 4336.80, null],
  ["15mm 45 STREET ELBOW MxF COPPER PRESS", 2080, 0.81, 1684.80, null],
  ["22mm 45 STREET ELBOW MxF COPPER PRESS", 2080, 1.42, 2953.60, null],
  ["15mm TEE - EQUAL COPPER PRESS M-PROFILE", 542, 1.52, 823.84, null],
  ["22mm TEE - EQUAL COPPER PRESS M-PROFILE", 1050, 2.36, 2478.00, null],
  ["15x15x22mm REDUCED END PRESS TEE", 520, 2.86, 1487.20, null],
  ["22x22x15mm REDUCED BRANCH PRESS TEE", 564, 2.74, 1545.36, null],
  ["22x15x15mm REDUCE END & BRANCH PRESS TEE", 520, 3.41, 1773.20, null],
  ["22 x 3/4\" STR MALE CONN COPPER PRESS", 1040, 1.71, 1778.40, null],
  ["15mm x 1/2\" CP STRAIGHT SERVICE VALVE", 520, 1.50, 780.00, "CP means compression — I have quoted for Pressfit."],
  ["1/2 X 15mm COMPRESSION BACKPLATE ELBOW", 1040, 2.88, 2995.20, "My backplate elbow is pressfit — they have quoted you compression which explains the big difference."],
  ["1/2\" BSP THERMAL BALANCE VALVE C/W GAUGE AND INSUL", 542, 50.99, 27636.58, null],
  ["1/2\" BSP M X F MINI BALL VALVE", 1084, 2.01, 2178.84, null],
  ["15mm 2-IN-1 EASIFIT TMV2/3 MIXING VALVE", 1040, 19.50, 20280.00, null],
  ["SHOWER FAST FIXING KIT (PLATE)", 27, 4.86, 131.22, null],
];

function round2(n) { return Math.round(n * 100) / 100; }

async function main() {
  const saleTotal = round2(LINES.reduce((s, [, , , t]) => s + t, 0));
  console.log(`Sale total (sum of lines): £${saleTotal.toFixed(2)} (sheet shows £96,732.60)`);
  if (saleTotal !== 96732.60) throw new Error(`Total ${saleTotal} != 96732.60`);

  const ticket = await prisma.ticket.create({
    data: {
      title: TITLE,
      description: "Cromwell quote — copper press fittings & valves (Pressfit). From 3-way comparison sheet (WhatsApp 2026-06-03). Values are our quoted sale prices.",
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      payingCustomerId: CUSTOMER_ID,
      ticketMode: "PRICING_FIRST",
      scopeType: "Copper Press Fittings & Valves",
      status: "PRICING",
      quoteRequired: true,
      quoteStatus: "DRAFT",
      source: "OTHER",
      sourceRef: "WhatsApp quote sheet 2026-06-03",
    },
  });
  console.log(`Created Ticket T-${ticket.ticketNo} (${ticket.id}) — "${ticket.title}"`);

  for (let i = 0; i < LINES.length; i++) {
    const [description, qty, saleUnit, lineTotal, note] = LINES[i];
    await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        displayOrder: i + 1,
        lineType: "MATERIAL",
        description,
        qty,
        unit: "EA",
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        payingCustomerId: CUSTOMER_ID,
        status: "PRICED",
        suggestedSaleUnit: saleUnit,
        actualSaleUnit: saleUnit,
        actualSaleTotal: lineTotal,
        internalNotes: note,
        sectionLabel: "Copper Press Fittings & Valves",
      },
    });
  }
  console.log(`Created ${LINES.length} TicketLines · sale total £${saleTotal.toFixed(2)}`);
  console.log(`Ticket URL: /tickets/${ticket.id}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

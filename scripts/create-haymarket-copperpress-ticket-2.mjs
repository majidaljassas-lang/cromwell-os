#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TITLE = "Haymarket — Copper Press Fittings & Valves (35–67mm + Ball/DZR Valves)";
const CUSTOMER_ID = "9b2be5a2-71d0-450e-8460-0d708795c51a"; // WEST END (LONDON) PROPERTY LTD
const SITE_ID = "9644db39-6ab1-4724-b19e-2d9c5932ec5b"; // Haymarket
const SCL_ID = "ea7733a8-fd28-460a-af9a-f35bd648fd5b"; // West End ↔ Haymarket, Main Contractor

// Cromwell column from the quote sheet. Unit £ = our SALE price.
// [description, qty, saleUnit, saleTotal]
const LINES = [
  ["67mm 90 ELBOW COPPER PRESS M-PROFILE", 8, 30.96, 247.68],
  ["54mm 90 ELBOW COPPER PRESS M-PROFILE", 33, 10.32, 340.56],
  ["42mm 90 ELBOW COPPER PRESS M-PROFILE", 40, 6.45, 258.00],
  ["35mm 90 ELBOW COPPER PRESS M-PROFILE", 293, 4.32, 1265.76],
  ["28mm 90 ELBOW COPPER PRESS M-PROFILE", 800, 2.34, 1872.00],
  ["22mm 90 ELBOW COPPER PRESS M-PROFILE", 645, 1.35, 870.75],
  ["15mm 90 ELBOW COPPER PRESS M-PROFILE", 240, 0.78, 187.20],
  ["28mm 90 STREET ELBOW MxF COPPER PRESS", 112, 2.48, 277.76],
  ["22mm 90 STREET ELBOW MxF COPPER PRESS", 112, 1.42, 159.04],
  ["15mm 90 STREET ELBOW MxF COPPER PRESS", 57, 0.79, 45.03],
  ["35mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 139, 3.79, 526.81],
  ["35mm 45 STREET ELBOW MxF COPPER PRESS", 85, 3.77, 320.45],
  ["54mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 4, 8.60, 34.40],
  ["42mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 4, 6.14, 24.56],
  ["28mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 141, 2.27, 320.07],
  ["22mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 871, 1.25, 1088.75],
  ["28mm 45 STREET ELBOW MxF COPPER PRESS", 48, 2.03, 97.44],
  ["22mm 45 STREET ELBOW MxF COPPER PRESS", 180, 1.25, 225.00],
  ["15mm 45 ELBOW FxF COPPER PRESS M-PROFILE", 420, 0.78, 327.60],
  ["15mm 45 STREET ELBOW MxF COPPER PRESS", 87, 0.77, 66.99],
  ["42MM STRAIGHT COUPLER COPPER PRESS", 6, 3.62, 21.72],
  ["35MM STRAIGHT COUPLER COPPER PRESS", 35, 2.29, 80.15],
  ["54MM STRAIGHT COUPLER COPPER PRESS", 6, 5.06, 30.36],
  ["15MM STRAIGHT COUPLER COPPER PRESS", 32, 0.61, 19.52],
  ["22MM STRAIGHT COUPLER COPPER PRESS", 166, 0.94, 156.04],
  ["28MM STRAIGHT COUPLER COPPER PRESS", 130, 1.50, 195.00],
  ["67x67x35mm REDUCED BRANCH PRESS TEE", 2, 51.97, 103.94],
  ["54x54x42mm REDUCED BRANCH PRESS TEE", 2, 13.39, 26.78],
  ["54x54x22mm REDUCED BRANCH PRESS TEE", 4, 15.42, 61.68],
  ["54x35x54mm TEE REDUCED BRANCH COPPER", 2, 21.86, 43.72],
  ["54x54x35mm REDUCED BRANCH PRESS TEE", 4, 10.77, 43.08],
  ["54x54x28mm REDUCED BRANCH PRESS TEE", 3, 14.59, 43.77],
  ["42x42x28mm REDUCED BRANCH PRESS TEE", 5, 9.54, 47.70],
  ["42x42x15mm REDUCED BRANCH PRESS TEE", 4, 6.89, 27.56],
  ["42x28x42mm TEE - REDUCED BRANCH COPPER", 1, 15.78, 15.78],
  ["42x42x35mm REDUCED BRANCH PRESS TEE", 6, 8.73, 52.38],
  ["42x35x35mm REDUCE END & BRANCH PRESS TEE", 1, 11.73, 11.73],
  ["35x35x22mm REDUCED BRANCH PRESS TEE", 89, 6.22, 553.58],
  ["35x28x28mm REDUCE END & BRANCH PRESS TEE", 101, 9.99, 1008.99],
  ["28x28x22mm REDUCED BRANCH PRESS TEE", 195, 3.63, 707.85],
  ["28x28x15mm TEE - REDUCED BRANCH COPPER", 93, 3.48, 323.64],
  ["35x28x28mm TEE - REDUCE END & BRANCH COPPER", 20, 10.54, 210.80],
  ["28x22x22mm REDUCE END & BRANCH PRESS TEE", 192, 3.63, 696.96],
  ["22x22x15mm REDUCED BRANCH PRESS TEE", 117, 2.35, 274.95],
  ["22x15x15mm REDUCE END & BRANCH PRESS TEE", 91, 2.82, 256.62],
  ["28mm TEE - EQUAL COPPER PRESS M-PROFILE", 38, 3.50, 133.00],
  ["22mm TEE - EQUAL COPPER PRESS M-PROFILE", 43, 2.24, 96.32],
  ["67 X 54mm FITTING REDUCER COPPER PRESS", 2, 16.42, 32.84],
  ["54 X 42mm FITTING REDUCER COPPER PRESS", 5, 4.16, 20.80],
  ["42 X 35mm FITTING REDUCER COPPER PRESS", 2, 2.57, 5.14],
  ["22 X 15mm FITTING REDUCER COPPER PRESS", 70, 0.73, 51.10],
  ["28 X 22mm FITTING REDUCER COPPER PRESS", 167, 1.19, 198.73],
  ["22 X 15mm FITTING REDUCER COPPER PRESS", 65, 0.73, 47.45],
  ["28 X 15mm FITTING REDUCER COPPER PRESS", 20, 1.13, 22.60],
  ["22 x 3/4\" STR MALE CONN COPPER PRESS", 840, 1.58, 1327.20],
  ["22MM X 3/4\" STR UNION CONNECTOR MALE", 840, 4.36, 3662.40],
  ["15 x 1/2\" STR MALE CONN COPPER PRESS", 420, 1.09, 457.80],
  ["15MM X 1/2\" STR UNION CONNECTOR MALE", 420, 2.93, 1230.60],
  ["3/4\" BSP BRASS BALL VALVE BLUE LEVER WRAS", 420, 3.91, 1642.20],
  ["3/4\" BSP BRASS BALL VALVE RED LEVER WRAS", 420, 4.21, 1768.20],
  ["1/2\" BSP DZR BALL VALVE FxF WRAS", 420, 3.07, 1289.40],
];

function round2(n) { return Math.round(n * 100) / 100; }

async function main() {
  // Verify every line: qty × unit must equal the provided line total (within 1p).
  const mismatches = [];
  for (let i = 0; i < LINES.length; i++) {
    const [desc, qty, unit, total] = LINES[i];
    const calc = round2(qty * unit);
    if (Math.abs(calc - total) > 0.01) mismatches.push(`  L${i + 1} "${desc}": ${qty} × £${unit} = £${calc} but sheet says £${total}`);
  }
  if (mismatches.length) {
    console.error(`ABORT — ${mismatches.length} line(s) where qty × unit ≠ line total:`);
    console.error(mismatches.join("\n"));
    process.exit(1);
  }
  const saleTotal = round2(LINES.reduce((s, [, , , t]) => s + t, 0));
  console.log(`All ${LINES.length} lines verified (qty × unit = line total).`);
  console.log(`Sale total (sum of lines): £${saleTotal.toFixed(2)}`);

  const ticket = await prisma.ticket.create({
    data: {
      title: TITLE,
      description: "Cromwell quote — copper press fittings & valves (35–67mm bore range, plus ball/DZR valves). Values are our quoted sale prices.",
      siteId: SITE_ID,
      siteCommercialLinkId: SCL_ID,
      payingCustomerId: CUSTOMER_ID,
      ticketMode: "PRICING_FIRST",
      scopeType: "Copper Press Fittings & Valves",
      status: "PRICING",
      quoteRequired: true,
      quoteStatus: "DRAFT",
      source: "OTHER",
      sourceRef: "Pasted quote sheet 2026-06-22",
    },
  });
  console.log(`Created Ticket T-${ticket.ticketNo} (${ticket.id}) — "${ticket.title}"`);

  for (let i = 0; i < LINES.length; i++) {
    const [description, qty, saleUnit, lineTotal] = LINES[i];
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

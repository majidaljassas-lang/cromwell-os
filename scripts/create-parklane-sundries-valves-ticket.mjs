#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CUSTOMER_ID = "a0910826-f73e-4b36-87d8-60187e2a0efb"; // Criterion Developments
const TITLE = "Park Lane - Sundries and Valves";
const SECTION = "Sundries & Valves";

// [description, qty, unit, saleUnit]
const LINES = [
  ["Copper press reducing tee 54x54x42 (42 centre)", 10, "EA", 24.0],
  ["Copper press reducing tee 54x54x35 (35 centre)", 10, "EA", 22.0],
  ['5" grinder metal cutting disc, 1mm thick', 100, "EA", 0.85],
  ["Wago junction boxes", 100, "EA", 2.2],
  ["Wago 2-way connectors", 200, "EA", 0.3],
  ["Wago 3-way connectors", 200, "EA", 0.42],
  ["Wago 5-way connectors", 200, "EA", 0.62],
  ["M10 threaded rod x 3M", 30, "LENGTH", 4.0],
  ["M8 hex nuts", 500, "EA", 0.06],
  ["M8 square plates", 300, "EA", 0.14],
  ["M8 channel nuts", 300, "EA", 0.5],
  ["54mm copper pipe x 3M", 20, "LENGTH", 62.0],
  ['1/2" BSP brass ball valve, blue lever, WRAS', 30, "EA", 4.5],
  ['3/4" BSP brass ball valve, blue lever, WRAS', 30, "EA", 6.5],
  ['1" BSP brass ball valve, blue lever, WRAS', 20, "EA", 11.0],
  ["Solvent cleaner 250ml", 5, "EA", 6.0],
];

async function main() {
  const ticket = await prisma.ticket.create({
    data: {
      title: TITLE,
      payingCustomerId: CUSTOMER_ID,
      ticketMode: "PRICING_FIRST",
      status: "PRICING",
      revenueState: "OPERATIONAL",
      manualMode: true,
      description:
        "Materials sell list for Park Lane (sundries and valves). Favour price for Criterion Developments - priced keen to land just over £3k, not a competitive bid.",
    },
  });
  console.log(`Created Ticket T-${ticket.ticketNo} (${ticket.id})`);

  let total = 0;
  for (let i = 0; i < LINES.length; i++) {
    const [description, qty, unit, saleUnit] = LINES[i];
    const lineTotal = Math.round(qty * saleUnit * 100) / 100;
    total += lineTotal;
    await prisma.ticketLine.create({
      data: {
        ticketId: ticket.id,
        payingCustomerId: CUSTOMER_ID,
        lineType: "MATERIAL",
        description,
        qty,
        unit,
        displayOrder: i + 1,
        status: "PRICED",
        suggestedSaleUnit: saleUnit,
        actualSaleUnit: saleUnit,
        actualSaleTotal: lineTotal,
        sectionLabel: SECTION,
      },
    });
    console.log(
      `  ${String(i + 1).padStart(2)}. ${description} — ${qty} @ £${saleUnit.toFixed(2)} = £${lineTotal.toFixed(2)}`
    );
  }
  console.log(`\nTotal: £${total.toFixed(2)} ex VAT across ${LINES.length} lines`);
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

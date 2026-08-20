#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "914d46fb-7884-4a8b-82e0-afb4622af2ee";

async function main() {
  // First, see how cost fields are populated across the ticket.
  const counts = await prisma.$queryRawUnsafe(
    `SELECT
       count(*)::int AS total,
       count("expectedCostUnit")::int AS with_exp_unit,
       count("expectedCostTotal")::int AS with_exp_total,
       count("actualCostTotal")::int AS with_act_total,
       count("benchmarkUnit")::int AS with_bench_unit
     FROM "TicketLine" WHERE "ticketId"=$1`,
    TICKET_ID,
  );
  console.log("Cost field coverage:", counts[0]);

  const uncosted = await prisma.ticketLine.findMany({
    where: {
      ticketId: TICKET_ID,
      expectedCostUnit: null,
      expectedCostTotal: null,
      actualCostTotal: null,
    },
    orderBy: { displayOrder: "asc" },
    select: {
      displayOrder: true,
      sectionLabel: true,
      description: true,
      productCode: true,
      qty: true,
      unit: true,
      isBomParent: true,
      parentLineId: true,
    },
  });

  console.log(`\nUncosted lines (no expectedCost, no actualCost): ${uncosted.length}\n`);

  let currentSection = null;
  for (const l of uncosted) {
    if (l.sectionLabel !== currentSection) {
      currentSection = l.sectionLabel;
      console.log(`\n=== ${currentSection} ===`);
    }
    const tag = l.isBomParent ? "[BOM]" : l.parentLineId ? "  └─" : "    ";
    console.log(
      `  #${String(l.displayOrder).padStart(3)} ${tag} ${(l.productCode || "").padEnd(18)} ${(l.description || "").slice(0, 80)}  (${l.qty} ${l.unit})`,
    );
  }

  // Section summary.
  const bySection = {};
  for (const l of uncosted) {
    bySection[l.sectionLabel] = (bySection[l.sectionLabel] || 0) + 1;
  }
  console.log("\n--- Uncosted count by section ---");
  for (const [k, v] of Object.entries(bySection)) console.log(`  ${v.toString().padStart(3)}  ${k}`);
}
main().finally(() => prisma.$disconnect());

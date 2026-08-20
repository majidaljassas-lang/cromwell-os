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
  const total = await prisma.ticketLine.count({ where: { ticketId: TICKET_ID } });
  console.log(`Total lines: ${total}`);

  const groups = await prisma.ticketLine.groupBy({
    by: ["sectionLabel"],
    where: { ticketId: TICKET_ID },
    _count: { _all: true },
    _min: { displayOrder: true },
    _max: { displayOrder: true },
  });
  groups.sort((a, b) => (a._min.displayOrder ?? 0) - (b._min.displayOrder ?? 0));
  console.log("\nSections in order:");
  for (const g of groups) {
    console.log(
      `  #${String(g._min.displayOrder).padStart(3)}-${String(g._max.displayOrder).padStart(3)}  count=${g._count._all}  ${g.sectionLabel}`,
    );
  }

  // Check for duplicate displayOrders.
  const dupes = await prisma.$queryRawUnsafe(
    `SELECT "displayOrder", count(*) FROM "TicketLine" WHERE "ticketId"=$1 GROUP BY "displayOrder" HAVING count(*) > 1`,
    TICKET_ID,
  );
  console.log(`\nDuplicate displayOrders: ${dupes.length}`);
  if (dupes.length) console.log(dupes);
}
main().finally(() => prisma.$disconnect());

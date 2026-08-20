#!/usr/bin/env node
// Prepend productCode to description on TicketLines + QuoteLines for ticket 145395c2.

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TICKET_ID = "145395c2-4e77-4bd9-a7e0-362ef365fa4e";

function withCode(code, desc) {
  if (!code) return desc;
  if (desc.startsWith(code)) return desc;
  return `${code} — ${desc}`;
}

async function main() {
  const lines = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    select: { id: true, productCode: true, description: true,
      quoteLines: { select: { id: true, description: true } },
    },
  });

  let tlUpdates = 0;
  let qlUpdates = 0;
  for (const l of lines) {
    const newDesc = withCode(l.productCode, l.description);
    if (newDesc !== l.description) {
      await prisma.ticketLine.update({ where: { id: l.id }, data: { description: newDesc } });
      tlUpdates++;
    }
    for (const ql of l.quoteLines) {
      const newQl = withCode(l.productCode, ql.description);
      if (newQl !== ql.description) {
        await prisma.quoteLine.update({ where: { id: ql.id }, data: { description: newQl } });
        qlUpdates++;
      }
    }
  }
  console.log(`Updated ${tlUpdates} TicketLine descriptions, ${qlUpdates} QuoteLine descriptions`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const quoteRefs = [
    { ref: "Q-1786013172116", ticketId: "0a83a854-9576-4d17-857b-5c8f45549799" },
    { ref: "Q-1786014520373", ticketId: "34f437b4-a689-4068-b279-fb13c53b4424" },
    { ref: "Q-1786016745764", ticketId: "4e1ddde9-7746-43a1-9ecb-becd8adc2a0e" },
  ];

  console.log("📋 QUOTE LINE ITEMS BY TICKET\n");
  console.log("=".repeat(80) + "\n");

  for (const { ref, ticketId } of quoteRefs) {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        title: true,
        quotes: {
          where: { quoteNo: ref },
          include: { lines: true }
        }
      }
    });

    if (!ticket || ticket.quotes.length === 0) {
      console.log(`❌ ${ref} — Quote not found`);
      continue;
    }

    const quote = ticket.quotes[0];
    console.log(`✓ ${ref}`);
    console.log(`  Ticket: ${ticket.title}`);
    console.log(`  Quote Lines (${quote.lines.length}):`);

    quote.lines.forEach((line, i) => {
      console.log(`    ${i + 1}. ${line.description}`);
      console.log(`       Qty: ${line.qty} × £${line.unitPrice} = £${line.lineTotal}`);
    });
    console.log();
  }

  console.log("=".repeat(80));
  pool.end();
}

main().catch(console.error);

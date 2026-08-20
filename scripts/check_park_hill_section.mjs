#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const ticketId = "914d46fb-7884-4a8b-82e0-afb4622af2ee";

  const matches = await prisma.ticketLine.findMany({
    where: {
      ticketId,
      OR: [
        { sectionLabel: { contains: "FLAT 3", mode: "insensitive" } },
        { description: { contains: "FLAT 3", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      displayOrder: true,
      sectionLabel: true,
      description: true,
      isBomParent: true,
      parentLineId: true,
    },
    orderBy: { displayOrder: "asc" },
  });

  console.log(`Lines mentioning 'FLAT 3': ${matches.length}\n`);
  for (const l of matches.slice(0, 40)) {
    console.log(`#${String(l.displayOrder).padStart(3)} bom=${l.isBomParent ? "Y" : "n"} parent=${l.parentLineId ? "Y" : "n"} | section=${JSON.stringify(l.sectionLabel)} | desc=${(l.description || "").slice(0, 80)}`);
  }

  console.log("\n--- Distinct section labels on this ticket ---");
  const sections = await prisma.ticketLine.findMany({
    where: { ticketId, sectionLabel: { not: null } },
    select: { sectionLabel: true },
    distinct: ["sectionLabel"],
    orderBy: { sectionLabel: "asc" },
  });
  for (const s of sections) console.log(`  ${s.sectionLabel}`);
}
main().finally(() => prisma.$disconnect());

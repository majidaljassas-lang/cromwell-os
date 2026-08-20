#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const ticketId = process.argv[2];
  const lines = await prisma.ticketLine.findMany({
    where: { ticketId },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    select: { id: true, displayOrder: true, parentLineId: true, description: true, createdAt: true, isBomParent: true },
  });
  console.log(`Ticket ${ticketId}: ${lines.length} lines\n`);
  for (const l of lines) {
    const indent = l.parentLineId ? "  ↳ " : "    ";
    console.log(`#${String(l.displayOrder).padStart(2)} ${indent}id=${l.id.slice(0,8)} parent=${l.parentLineId?.slice(0,8) ?? "-"} bom=${l.isBomParent} | ${l.description.slice(0,60)}`);
  }
}
main().finally(() => prisma.$disconnect());

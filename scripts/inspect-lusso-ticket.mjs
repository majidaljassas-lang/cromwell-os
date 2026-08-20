#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const id = process.argv[2];
  const ticket = await prisma.ticket.findFirst({
    where: id ? { id: { startsWith: id } } : { lines: { some: { description: { contains: "Luxe", mode: "insensitive" } } } },
    include: {
      lines: {
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          description: true,
          productCode: true,
          qty: true,
          unit: true,
          expectedCostUnit: true,
          expectedCostTotal: true,
          actualSaleUnit: true,
          actualSaleTotal: true,
          createdAt: true,
          updatedAt: true,
          status: true,
          sectionLabel: true,
          productCode: true,
          displayOrder: true,
        },
      },
    },
  });
  if (!ticket) { console.log("not found"); return; }
  console.log("Ticket:", ticket.id, "-", ticket.title || ticket.reference);
  console.log("Lines (createdAt order):");
  for (const l of ticket.lines) {
    console.log(`  ${l.id} | #${l.displayOrder ?? "-"} | ${l.productCode || "-"} | ${l.description.slice(0,55)} | qty=${l.qty} cost=${l.expectedCostUnit} sale=${l.actualSaleUnit}`);
  }
}
main().finally(() => prisma.$disconnect());

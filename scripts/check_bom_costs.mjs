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
  const uncostedChildren = await prisma.ticketLine.findMany({
    where: {
      ticketId: TICKET_ID,
      expectedCostUnit: null,
      expectedCostTotal: null,
      actualCostTotal: null,
      parentLineId: { not: null },
    },
    orderBy: { displayOrder: "asc" },
    select: {
      id: true,
      displayOrder: true,
      sectionLabel: true,
      description: true,
      qty: true,
      unit: true,
      parentLineId: true,
    },
  });

  const parentIds = [...new Set(uncostedChildren.map((c) => c.parentLineId))];
  const parents = await prisma.ticketLine.findMany({
    where: { id: { in: parentIds } },
    select: {
      id: true,
      displayOrder: true,
      sectionLabel: true,
      description: true,
      qty: true,
      unit: true,
      expectedCostUnit: true,
      expectedCostTotal: true,
      isBomParent: true,
    },
  });
  const parentMap = new Map(parents.map((p) => [p.id, p]));

  console.log(`Uncosted BOM children: ${uncostedChildren.length}\n`);
  let rolledUp = 0;
  let trueGap = 0;
  for (const c of uncostedChildren) {
    const p = parentMap.get(c.parentLineId);
    const parentCosted = p && (p.expectedCostUnit != null || p.expectedCostTotal != null);
    const flag = parentCosted ? "ROLLED-UP" : "GAP      ";
    if (parentCosted) rolledUp++;
    else trueGap++;
    const parentCost = p
      ? `parent #${p.displayOrder} bomParent=${p.isBomParent} expUnit=${p.expectedCostUnit ?? "-"} expTotal=${p.expectedCostTotal ?? "-"}`
      : "parent NOT FOUND";
    console.log(
      `[${flag}] #${String(c.displayOrder).padStart(3)} ${c.sectionLabel}`,
    );
    console.log(`            child: ${c.description.slice(0, 75)}`);
    console.log(`            ${parentCost}: ${p?.description.slice(0, 60) ?? ""}`);
  }
  console.log(`\nRolled-up (parent has cost): ${rolledUp}`);
  console.log(`True gaps (parent also uncosted): ${trueGap}`);
}
main().finally(() => prisma.$disconnect());

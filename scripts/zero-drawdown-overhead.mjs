#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const entries = await prisma.labourDrawdownEntry.findMany({
    select: {
      id: true,
      customerPOId: true,
      billableValue: true,
      internalCostValue: true,
      overheadValue: true,
      grossProfitValue: true,
    },
  });

  console.log(`Found ${entries.length} labour drawdown entries`);

  let updated = 0;
  for (const e of entries) {
    const billable = Number(e.billableValue) || 0;
    const cost = Number(e.internalCostValue) || 0;
    const newProfit = billable - cost;

    const oldOverhead = Number(e.overheadValue) || 0;
    const oldProfit = Number(e.grossProfitValue) || 0;

    if (oldOverhead === 0 && Math.abs(oldProfit - newProfit) < 0.001) continue;

    await prisma.labourDrawdownEntry.update({
      where: { id: e.id },
      data: { overheadValue: 0, grossProfitValue: newProfit },
    });
    updated++;
  }

  console.log(`Zeroed overhead + recomputed profit on ${updated} entries`);

  const pos = await prisma.customerPO.findMany({
    where: { poType: "DRAWDOWN_LABOUR" },
    select: { id: true, poNo: true },
  });

  let posUpdated = 0;
  for (const po of pos) {
    const rows = await prisma.labourDrawdownEntry.findMany({
      where: { customerPOId: po.id },
      select: { grossProfitValue: true },
    });
    const profitToDate = rows.reduce((s, r) => s + (Number(r.grossProfitValue) || 0), 0);
    await prisma.customerPO.update({
      where: { id: po.id },
      data: { profitToDate },
    });
    posUpdated++;
  }

  console.log(`Recomputed profitToDate on ${posUpdated} labour drawdown POs`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

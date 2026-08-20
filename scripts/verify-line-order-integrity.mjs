#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function checkSet(label, rows, idKey, parentKey, orderKey) {
  // Build per-bucket map
  const buckets = new Map();
  for (const r of rows) {
    const b = buckets.get(r._bucket) ?? [];
    b.push(r);
    buckets.set(r._bucket, b);
  }
  let bad = 0;
  for (const [bucket, list] of buckets) {
    list.sort((a, b) => a[orderKey] - b[orderKey] || a[idKey].localeCompare(b[idKey]));
    const orders = list.map((l) => l[orderKey]);
    const set = new Set(orders);
    const hasDupe = set.size !== orders.length;
    const hasGap = orders.some((v, i) => i > 0 && v !== orders[i - 1] + 1) || orders[0] !== 1;
    if (hasDupe || hasGap) {
      bad++;
      console.log(`  [${label}] bucket ${bucket}: dupe=${hasDupe} gap=${hasGap} orders=${orders.join(",")}`);
    }
  }
  console.log(`[${label}] checked ${buckets.size} buckets, ${bad} with gaps or duplicates`);
}

async function main() {
  const invLines = await prisma.salesInvoiceLine.findMany({ select: { id: true, salesInvoiceId: true, displayOrder: true } });
  await checkSet("invoice-lines", invLines.map((l) => ({ ...l, _bucket: l.salesInvoiceId })), "id", null, "displayOrder");

  const qLines = await prisma.quoteLine.findMany({ select: { id: true, quoteId: true, sortOrder: true } });
  await checkSet("quote-lines", qLines.map((l) => ({ ...l, _bucket: l.quoteId })), "id", null, "sortOrder");

  const tLines = await prisma.ticketLine.findMany({ select: { id: true, ticketId: true, displayOrder: true } });
  await checkSet("ticket-lines", tLines.map((l) => ({ ...l, _bucket: l.ticketId })), "id", null, "displayOrder");
}
main().finally(() => prisma.$disconnect());

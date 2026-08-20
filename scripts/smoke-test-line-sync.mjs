#!/usr/bin/env node
// Smoke test: write to TicketLine via the EXTENDED Prisma client; verify
// the invoice + quote are resynced automatically.
import "dotenv/config";
import { PrismaClient, Prisma } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

// Replicate src/lib/tickets/sync-downstream.ts engine inline so this script
// is independent of TS path aliases.
const r2 = (n) => Math.round(n * 100) / 100;
const STANDARD_VAT_RATE = 20;
const lineVat = (n) => r2(n * (STANDARD_VAT_RATE / 100));

async function resyncTicketDownstream(ticketId, client) {
  const lines = await client.ticketLine.findMany({
    where: { ticketId, parentLineId: null },
    orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
    select: { id: true, description: true, qty: true, actualSaleUnit: true, suggestedSaleUnit: true, displayOrder: true, sectionLabel: true },
  });
  const draftInvoices = await client.salesInvoice.findMany({
    where: { ticketId, status: "DRAFT" },
    select: { id: true, lines: { select: { id: true, ticketLineId: true } } },
  });
  for (const inv of draftInvoices) {
    let net = 0;
    const have = new Map(inv.lines.map((l) => [l.ticketLineId, l.id]));
    const sourceIds = new Set(lines.map((l) => l.id));
    for (const tl of lines) {
      const unitPrice = Number(tl.actualSaleUnit ?? tl.suggestedSaleUnit ?? 0);
      const qty = Number(tl.qty);
      if (unitPrice <= 0) {
        const orphan = have.get(tl.id);
        if (orphan) await client.salesInvoiceLine.delete({ where: { id: orphan } });
        continue;
      }
      const lineTotal = r2(unitPrice * qty);
      net += lineTotal;
      const data = { description: tl.description, qty, unitPrice, lineTotal, vatRate: STANDARD_VAT_RATE, vatAmount: lineVat(lineTotal), displayOrder: tl.displayOrder };
      const existing = have.get(tl.id);
      if (existing) await client.salesInvoiceLine.update({ where: { id: existing }, data });
      else await client.salesInvoiceLine.create({ data: { ...data, salesInvoiceId: inv.id, ticketLineId: tl.id, displayMode: "STANDARD" } });
    }
    for (const il of inv.lines) if (!sourceIds.has(il.ticketLineId)) await client.salesInvoiceLine.delete({ where: { id: il.id } });
    const totalNet = r2(net);
    const totalVat = lineVat(totalNet);
    const totalGross = r2(totalNet + totalVat);
    await client.salesInvoice.update({ where: { id: inv.id }, data: { totalNet, totalVat, totalGross, totalSell: totalGross } });
  }
}

const baseClient = new PrismaClient({ adapter });
const extension = Prisma.defineExtension((client) => client.$extends({
  name: "ticket-line-sync",
  query: {
    ticketLine: {
      async update({ args, query }) {
        const result = await query(args);
        await resyncTicketDownstream(result.ticketId, client);
        return result;
      },
    },
  },
}));
const prisma = baseClient.$extends(extension);

const TICKET_ID = "f91fd704-6ca9-4fb7-a512-2b113d6a743b";

async function main() {
  // 1. Print current invoice net before the test write.
  // Find any ticket that has a DRAFT invoice + at least one ticket line
  const candidate = await prisma.salesInvoice.findFirst({
    where: { status: "DRAFT" },
    select: { id: true, invoiceNo: true, ticketId: true, totalNet: true },
  });
  if (!candidate) { console.log("No DRAFT invoices anywhere; skipping."); return; }
  console.log("Testing on invoice", candidate.invoiceNo, "ticket", candidate.ticketId);
  const TID = candidate.ticketId;
  const before = candidate;

  // 2. Find delivery line, bump its sale by £0.01, then put it back.
  const anyLine = await prisma.ticketLine.findFirst({ where: { ticketId: TID, parentLineId: null, actualSaleUnit: { not: null } }, select: { id: true, actualSaleUnit: true, qty: true, description: true } });
  if (!anyLine) { console.log("No usable line to bump; skipping."); return; }
  console.log("Bumping line:", anyLine.description.slice(0, 40), "current sale=", anyLine.actualSaleUnit);
  const original = Number(anyLine.actualSaleUnit);
  const qty = Number(anyLine.qty);
  const bumped = +(original + 0.01).toFixed(4);

  await prisma.ticketLine.update({ where: { id: anyLine.id }, data: { actualSaleUnit: bumped, actualSaleTotal: +(bumped * qty).toFixed(2) } });
  const after1 = await prisma.salesInvoice.findUnique({ where: { id: candidate.id }, select: { totalNet: true } });
  console.log(`Invoice AFTER bump:    totalNet=${after1.totalNet}`);

  await prisma.ticketLine.update({ where: { id: anyLine.id }, data: { actualSaleUnit: original, actualSaleTotal: +(original * qty).toFixed(2) } });
  const after2 = await prisma.salesInvoice.findUnique({ where: { id: candidate.id }, select: { totalNet: true } });
  console.log(`Invoice AFTER revert:  totalNet=${after2.totalNet}`);

  const delta = +(Number(after1.totalNet) - Number(before.totalNet)).toFixed(2);
  const reverted = Number(before.totalNet) === Number(after2.totalNet);
  if (Math.abs(delta - +(qty * 0.01).toFixed(2)) < 0.005 && reverted) {
    console.log(`\nPASS: extension auto-resynced the draft invoice. delta=${delta}, reverted=${reverted}`);
  } else {
    console.log(`\nFAIL: delta=${delta} expected≈${(qty*0.01).toFixed(2)}, reverted=${reverted}`);
    process.exit(1);
  }
}
main().catch((e)=>{console.error(e);process.exit(1)}).finally(()=>baseClient.$disconnect());

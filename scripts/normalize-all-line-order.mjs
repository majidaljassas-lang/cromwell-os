#!/usr/bin/env node
// System-wide line-order normalisation:
//
//   1. For every ticket, recompute TicketLine.displayOrder so each parent is
//      immediately followed by its BOM children (children sorted by their
//      original displayOrder, then id, for stability).
//
//   2. For every SalesInvoice (any status), recompute SalesInvoiceLine
//      displayOrder + displayMode using the same rule. This is a
//      presentation-only change — unitPrice / lineTotal / VAT / totals are
//      not touched, so it's safe on SENT / PARTIALLY_PAID / PAID.
//
//   3. For every Quote (any status), do the equivalent on QuoteLine.sortOrder.
//
// Bypasses the ticket-line-sync extension — we update raw rows directly to
// avoid 9× redundant resyncs per ticket. After TicketLine writes we call the
// inline rebuild for the ticket's DRAFT downstream artifacts.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function buildOrder(lines) {
  const idsInScope = new Set(lines.map((l) => l.id));
  const childrenByParent = new Map();
  const orphans = [];
  for (const l of lines) {
    if (l.parentLineId) {
      if (idsInScope.has(l.parentLineId)) {
        const arr = childrenByParent.get(l.parentLineId) ?? [];
        arr.push(l);
        childrenByParent.set(l.parentLineId, arr);
      } else {
        // parent isn't in this scope — treat as top-level (rendered as a normal LINE)
        orphans.push(l);
      }
    }
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id));
  }
  const top = lines
    .filter((l) => l.parentLineId == null)
    .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id));
  const out = [];
  for (const p of top) {
    out.push({ line: p, isBomChild: false });
    for (const k of childrenByParent.get(p.id) ?? []) {
      out.push({ line: k, isBomChild: true });
    }
  }
  // Orphans go at the end as top-level rows so they still have a unique slot.
  orphans.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.id.localeCompare(b.id));
  for (const o of orphans) out.push({ line: o, isBomChild: false });
  return out;
}

async function normaliseTicketLines() {
  const tickets = await prisma.ticket.findMany({ select: { id: true } });
  let touched = 0;
  let lineWrites = 0;
  for (const t of tickets) {
    const lines = await prisma.ticketLine.findMany({
      where: { ticketId: t.id },
      select: { id: true, parentLineId: true, displayOrder: true },
    });
    if (lines.length === 0) continue;
    const ordered = buildOrder(lines);
    let changed = false;
    let rank = 0;
    for (const { line } of ordered) {
      rank++;
      if (line.displayOrder !== rank) {
        await prisma.ticketLine.update({ where: { id: line.id }, data: { displayOrder: rank } });
        lineWrites++;
        changed = true;
      }
    }
    if (changed) touched++;
  }
  console.log(`[ticket-line] normalised ${touched} tickets, ${lineWrites} line writes`);
}

async function normaliseInvoiceLines() {
  const invoices = await prisma.salesInvoice.findMany({
    select: { id: true, invoiceNo: true, status: true, lines: { select: { id: true, displayOrder: true, displayMode: true, ticketLine: { select: { id: true, parentLineId: true, displayOrder: true } } } } },
  });
  let touched = 0;
  let writes = 0;
  for (const inv of invoices) {
    if (inv.lines.length === 0) continue;
    // buildOrder uses `id` as the parent lookup key. TicketLine.parentLineId
    // points at TicketLine.id, so we key by ticketLine.id (NOT salesInvoiceLine.id)
    // and carry the real row id separately.
    const adapted = inv.lines
      .filter((l) => l.ticketLine)
      .map((l) => ({
        id: l.ticketLine.id,
        parentLineId: l.ticketLine.parentLineId ?? null,
        displayOrder: l.ticketLine.displayOrder ?? l.displayOrder,
        _rowId: l.id,
        _existingMode: l.displayMode,
        _existingOrder: l.displayOrder,
      }));
    const ordered = buildOrder(adapted);
    let changed = false;
    let rank = 0;
    for (const { line, isBomChild } of ordered) {
      rank++;
      const newMode = isBomChild ? "BOM_CHILD" : "LINE";
      if (line._existingOrder !== rank || line._existingMode !== newMode) {
        await prisma.salesInvoiceLine.update({ where: { id: line._rowId }, data: { displayOrder: rank, displayMode: newMode } });
        writes++;
        changed = true;
      }
    }
    if (changed) touched++;
  }
  console.log(`[invoice-line] normalised ${touched} invoices, ${writes} line writes`);
}

async function normaliseQuoteLines() {
  const quotes = await prisma.quote.findMany({
    select: { id: true, quoteNo: true, status: true, lines: { select: { id: true, sortOrder: true, ticketLine: { select: { id: true, parentLineId: true, displayOrder: true } } } } },
  });
  let touched = 0;
  let writes = 0;
  for (const q of quotes) {
    if (q.lines.length === 0) continue;
    const adapted = q.lines
      .filter((l) => l.ticketLine)
      .map((l) => ({
        id: l.ticketLine.id,
        parentLineId: l.ticketLine.parentLineId ?? null,
        displayOrder: l.ticketLine.displayOrder ?? l.sortOrder,
        _rowId: l.id,
        _existingOrder: l.sortOrder,
      }));
    const ordered = buildOrder(adapted);
    let changed = false;
    let rank = 0;
    for (const { line } of ordered) {
      rank++;
      if (line._existingOrder !== rank) {
        await prisma.quoteLine.update({ where: { id: line._rowId }, data: { sortOrder: rank } });
        writes++;
        changed = true;
      }
    }
    if (changed) touched++;
  }
  console.log(`[quote-line] normalised ${touched} quotes, ${writes} line writes`);
}

async function main() {
  console.log("Starting full line-order normalisation...\n");
  await normaliseTicketLines();
  await normaliseInvoiceLines();
  await normaliseQuoteLines();
  console.log("\nDone.");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

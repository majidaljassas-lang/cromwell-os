#!/usr/bin/env node
// Split ticket 0088/110038 (e7a810df) — 3 bundled POs become 3 new tickets.
// Usage: node scripts/split_ticket_110038.mjs [--apply]
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const TICKET_ID = "e7a810df-31e3-4116-bea2-f6de5511162a";
const SPLIT_POS = ["0088/110783", "0088/110785", "0088/110912"];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function splitOne(poNo, orig, titlePrefix) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.customerPO.findFirst({
      where: { ticketId: TICKET_ID, poNo },
      include: { lines: true },
    });
    if (!po) throw new Error(`PO ${poNo} not found on ticket`);

    const ticketLineIds = po.lines.map((l) => l.ticketLineId).filter(Boolean);

    const newTicket = await tx.ticket.create({
      data: {
        siteId: orig.siteId,
        siteCommercialLinkId: po.siteCommercialLinkId ?? orig.siteCommercialLinkId,
        payingCustomerId: po.customerId ?? orig.payingCustomerId,
        title: `${titlePrefix} — ${poNo}`,
        ticketMode: orig.ticketMode,
        status: orig.status,
        poRequired: true,
        poStatus: orig.poStatus,
        revenueState: orig.revenueState,
        deliveryBillingMode: orig.deliveryBillingMode,
      },
    });

    if (ticketLineIds.length > 0) {
      await tx.ticketLine.updateMany({
        where: { id: { in: ticketLineIds } },
        data: { ticketId: newTicket.id },
      });
    }

    await tx.customerPO.update({
      where: { id: po.id },
      data: { ticketId: newTicket.id },
    });

    const evidence = await tx.evidenceFragment.findFirst({
      where: { ticketId: TICKET_ID, fragmentType: "PO_RECEIVED", fragmentText: { contains: poNo } },
    });
    if (evidence) {
      await tx.evidenceFragment.update({
        where: { id: evidence.id },
        data: { ticketId: newTicket.id },
      });
      if (evidence.sourceRef?.startsWith("event:")) {
        const eventId = evidence.sourceRef.slice("event:".length);
        const ev = await tx.event.findUnique({ where: { id: eventId } });
        if (ev) {
          await tx.event.update({ where: { id: eventId }, data: { ticketId: newTicket.id } });
        }
      }
    }

    const taskMoves = await tx.task.updateMany({
      where: { ticketId: TICKET_ID, ticketLineId: { in: ticketLineIds } },
      data: { ticketId: newTicket.id },
    });

    return {
      poNo,
      newTicketId: newTicket.id,
      newTicketNo: newTicket.ticketNo,
      title: newTicket.title,
      lines: ticketLineIds.length,
      tasksMoved: taskMoves.count,
      evidenceMoved: evidence ? 1 : 0,
    };
  });
}

async function main() {
  const orig = await prisma.ticket.findUnique({ where: { id: TICKET_ID } });
  if (!orig) throw new Error("Original ticket not found");
  const titlePrefix = orig.title.split(" — ")[0]; // "London City"

  console.log(`Original ticket: ${orig.id} · #${orig.ticketNo} · "${orig.title}"`);
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}\n`);

  if (!APPLY) {
    for (const poNo of SPLIT_POS) {
      const po = await prisma.customerPO.findFirst({
        where: { ticketId: TICKET_ID, poNo },
        include: { lines: true },
      });
      const evidence = await prisma.evidenceFragment.findFirst({
        where: { ticketId: TICKET_ID, fragmentType: "PO_RECEIVED", fragmentText: { contains: poNo } },
      });
      const tlIds = po?.lines.map((l) => l.ticketLineId).filter(Boolean) ?? [];
      const tasks = await prisma.task.count({ where: { ticketId: TICKET_ID, ticketLineId: { in: tlIds } } });
      console.log(`  PO ${poNo}:`);
      console.log(`    new title: "${titlePrefix} — ${poNo}"`);
      console.log(`    move ${tlIds.length} ticketLines, 1 customerPO, ${evidence ? 1 : 0} evidence, ${tasks} tasks`);
      if (evidence?.sourceRef?.startsWith("event:")) {
        console.log(`    plus 1 PO_RECEIVED event (${evidence.sourceRef.slice(6, 14)})`);
      }
    }
    console.log(`\nRe-run with --apply to execute.`);
    return;
  }

  const results = [];
  for (const poNo of SPLIT_POS) {
    const r = await splitOne(poNo, orig, titlePrefix);
    console.log(`  ✓ ${r.poNo} → new ticket #${r.newTicketNo} (${r.newTicketId.slice(0, 8)}) · ${r.lines} lines, ${r.tasksMoved} tasks, ${r.evidenceMoved} evidence`);
    results.push(r);
  }
  console.log(`\nDone. ${results.length} new tickets created. Original ticket retains PO 0088/110038 + invoice.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });

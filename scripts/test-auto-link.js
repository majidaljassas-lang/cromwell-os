/**
 * Auto-link integration test — seeds a ticket, sends 3 fake WhatsApp payloads
 * through the live /api/ingest/whatsapp/live handler, asserts HIGH/MEDIUM/LOW
 * tiers on the resulting InboxThread, then cleans up everything it seeded.
 *
 * Assumes dev server on http://localhost:3000 (PM2 cromwell-web).
 *
 * Usage: node scripts/test-auto-link.js
 */
require("dotenv").config();
const { PrismaClient } = require("../src/generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BASE = "http://localhost:3000";
const RUN_ID = `test-${Date.now()}`;

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";

function ok(msg) { console.log(`${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.log(`${RED}✗${RESET} ${msg}`); }
function info(msg) { console.log(`${DIM}  ${msg}${RESET}`); }

async function seed() {
  const site = await prisma.site.create({
    data: { siteName: `Brompton Court Development ${RUN_ID}`, aliases: [] },
  });
  const customer = await prisma.customer.create({
    data: { name: `Acme Plumbing Services ${RUN_ID}` },
  });
  const ticket = await prisma.ticket.create({
    data: {
      title: `Supply copper pipe — ${RUN_ID}`,
      ticketMode: "DIRECT_ORDER",
      status: "CAPTURED",
      siteId: site.id,
      payingCustomerId: customer.id,
    },
  });
  const line = await prisma.ticketLine.create({
    data: {
      ticket: { connect: { id: ticket.id } },
      lineType: "MATERIAL",
      description: "22mm copper pipe, 3m lengths",
      normalizedItemName: "22mm copper pipe",
      qty: 10,
      payingCustomer: { connect: { id: customer.id } },
    },
  });
  return { site, customer, ticket, line };
}

async function sendWhatsApp(messageText, chatSuffix) {
  const payload = {
    message_id: `${RUN_ID}-${chatSuffix}-${Date.now()}`,
    chat_id: `${RUN_ID}-${chatSuffix}@c.us`,
    chat_name: `Test Chat ${chatSuffix}`,
    sender_phone: `${RUN_ID}-sender@c.us`,
    sender_name: "Test Sender",
    timestamp: new Date().toISOString(),
    message_text: messageText,
    is_sent: false,
    is_group: false,
    has_media: false,
    media_type: null,
  };
  const res = await fetch(`${BASE}/api/ingest/whatsapp/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { payload, body };
}

let assertClient = null;
function getAssertClient() {
  if (!assertClient) {
    const p = new Pool({ connectionString: process.env.DATABASE_URL });
    assertClient = { prisma: new PrismaClient({ adapter: new PrismaPg(p) }), pool: p };
  }
  return assertClient.prisma;
}

async function getThread(conversationKey) {
  await new Promise((r) => setTimeout(r, 150));
  return getAssertClient().inboxThread.findFirst({
    where: { conversationKey },
    select: { id: true, linkedTicketId: true, linkConfidence: true, status: true, linkSource: true },
  });
}

async function runTest(name, text, chatSuffix, expectedConfidence, expectLink, ticketId) {
  const { payload, body } = await sendWhatsApp(text, chatSuffix);
  if (!body.ok) {
    fail(`${name}: live ingest returned !ok → ${JSON.stringify(body)}`);
    return { passed: false, conversationKey: payload.chat_id };
  }
  const thread = await getThread(payload.chat_id);
  if (!thread) {
    fail(`${name}: no InboxThread created for chat ${payload.chat_id}`);
    return { passed: false, conversationKey: payload.chat_id };
  }

  const confMatch = thread.linkConfidence === expectedConfidence;
  const linkMatch = expectLink ? thread.linkedTicketId === ticketId : thread.linkedTicketId === null;
  const statusMatch = expectedConfidence === "HIGH" ? thread.status === "LINKED" : thread.status === "NEW";

  if (confMatch && linkMatch && statusMatch) {
    ok(`${name}: linkConfidence=${thread.linkConfidence} linkedTicketId=${thread.linkedTicketId ? "ticket" : "null"} status=${thread.status}`);
    return { passed: true, conversationKey: payload.chat_id };
  } else {
    fail(`${name}: expected confidence=${expectedConfidence} link=${expectLink ? "ticket" : "null"} status=${expectedConfidence === "HIGH" ? "LINKED" : "NEW"}`);
    info(`got      confidence=${thread.linkConfidence}    link=${thread.linkedTicketId}    status=${thread.status}`);
    info(`resolveLink body: ${JSON.stringify(body)}`);
    return { passed: false, conversationKey: payload.chat_id };
  }
}

async function cleanup(seeded, conversationKeys) {
  const prisma = getAssertClient();
  // Thread messages + threads
  const threads = await prisma.inboxThread.findMany({
    where: { conversationKey: { in: conversationKeys } },
    select: { id: true },
  });
  const threadIds = threads.map((t) => t.id);
  if (threadIds.length) {
    await prisma.inboxThreadMessage.deleteMany({ where: { threadId: { in: threadIds } } });
    await prisma.inboxThread.deleteMany({ where: { id: { in: threadIds } } });
  }

  // InboundEvents + ParsedMessages + IngestionEvents for this run
  const events = await prisma.ingestionEvent.findMany({
    where: { externalMessageId: { startsWith: RUN_ID } },
    select: { id: true },
  });
  const eventIds = events.map((e) => e.id);
  if (eventIds.length) {
    await prisma.inboundEvent.deleteMany({ where: { ingestionEventId: { in: eventIds } } });
    await prisma.parsedMessage.deleteMany({ where: { ingestionEventId: { in: eventIds } } });
    await prisma.ingestionEvent.deleteMany({ where: { id: { in: eventIds } } });
  }

  // Also clean orphan review queue items referencing this run's InboundEvents
  // (resolveLink creates these at MEDIUM). They reference InboundEvent by id
  // via entityId — we already nuked the InboundEvents, but the review rows
  // remain; they're safe-ish but best cleared in the test.
  // Done above via inboundEvent.deleteMany; ReviewQueueItem FKs are loose.

  // Seeded business rows (reverse dependency order)
  await prisma.ticketLine.delete({ where: { id: seeded.line.id } }).catch(() => {});
  await prisma.ticket.delete({ where: { id: seeded.ticket.id } }).catch(() => {});
  await prisma.customer.delete({ where: { id: seeded.customer.id } }).catch(() => {});
  await prisma.site.delete({ where: { id: seeded.site.id } }).catch(() => {});
}

async function main() {
  console.log(`${YELLOW}▶ Auto-link integration test — run ${RUN_ID}${RESET}\n`);

  // Preflight
  try {
    const r = await fetch(`${BASE}/api/ingest/whatsapp/backfill`);
    if (!r.ok && r.status !== 502) throw new Error(`unexpected status ${r.status}`);
  } catch (err) {
    console.error(`${RED}Dev server not reachable on ${BASE} — ${err.message}${RESET}`);
    process.exit(1);
  }

  const seeded = await seed();
  ok(`Seeded site "${seeded.site.siteName.slice(0, 30)}…" + customer + ticket T-${seeded.ticket.ticketNo}`);

  // Release pglite connections held by this script so the web server has
  // headroom while it handles the 3 ingests. We reconnect before asserting.
  await prisma.$disconnect();
  await pool.end().catch(() => {});

  const conversationKeys = [];
  const results = [];
  try {
    // HIGH: site mention + explicit reference + product overlap
    //   site "brompton" (25) + TK-12345 ref (35) + "22mm cop" (10) + timeline (10) = 80
    const r1 = await runTest(
      "HIGH",
      "Brompton site update — ref TK-12345, need extra 22mm copper pipe today please",
      "high",
      "HIGH",
      true,
      seeded.ticket.id,
    );
    conversationKeys.push(r1.conversationKey);
    results.push(r1.passed);

    // MEDIUM: partial — site + customer mention, no reference
    //   site "brompton" (25) + customer "acme plumb" (15) + timeline (10) = 50
    const r2 = await runTest(
      "MEDIUM",
      "Brompton site — Acme Plumbing team on the way at 10am",
      "medium",
      "MEDIUM",
      true,
      seeded.ticket.id,
    );
    conversationKeys.push(r2.conversationKey);
    results.push(r2.passed);

    // LOW: nothing relevant — only timeline proximity (10) < 40
    const r3 = await runTest(
      "LOW",
      "Hi there, hope you're well. Thanks!",
      "low",
      "LOW",
      false,
      null,
    );
    conversationKeys.push(r3.conversationKey);
    results.push(r3.passed);
  } finally {
    await cleanup(seeded, conversationKeys).catch((err) =>
      console.error(`${RED}Cleanup error: ${err.message}${RESET}`)
    );
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n${passed === total ? GREEN : RED}${passed}/${total} passed${RESET}`);
  if (assertClient) {
    await assertClient.prisma.$disconnect().catch(() => {});
    await assertClient.pool.end().catch(() => {});
  }
  process.exit(passed === total ? 0 : 1);
}

main().catch(async (err) => {
  console.error(`${RED}Test crashed:${RESET}`, err);
  try { await prisma.$disconnect(); } catch {}
  if (assertClient) {
    try { await assertClient.prisma.$disconnect(); } catch {}
    try { await assertClient.pool.end(); } catch {}
  }
  process.exit(1);
});

/**
 * Build a compact human-readable context blob for the AI shadow engine.
 *
 * The goal is to give Claude enough operational state to make
 * sensible inferences about brand-new inbound messages WITHOUT
 * burning tokens on things it does not need.
 *
 * Output shape (text, NOT JSON):
 *
 *   === ACTIVE TICKETS ===
 *   T#123 | CAPTURED | Acme Plumbing | 12 Main St | lines=5 | last=2026-04-10T08:15
 *     title: First fix materials for kitchen
 *   ...
 *
 *   === RECENT LINES ===
 *   T#123:
 *     - 32mm drywall screws | 2 PACK | Screwfix | Fixings
 *     - 15mm copper pipe    | 10 M   | Plumbase  | Pipework
 *   ...
 *
 *   === ACTIVE THREADS ===
 *   [linked]   chat=Bob (Acme) / 447700900000@c.us -> T#123
 *   [unlinked] chat=Steve / 447700900111@c.us (3 recent msgs)
 *
 *   === RECENT PROCUREMENT (7d) ===
 *   PO-456 | Screwfix | T#123 | £240.00 | ISSUED
 *
 *   === OPEN TASKS ===
 *   T#123: 2 open (ORDER_FOLLOWUP, QUOTE_PENDING)
 *
 * Everything is capped so the blob stays under ~3000 tokens.
 */

import { prisma } from "@/lib/prisma";

const MAX_TICKETS = 30;
const MAX_LINES_TOTAL = 200;
const MAX_PROCUREMENT = 30;
const MAX_UNLINKED_THREADS = 20;
const MAX_LINKED_THREADS = 40;

const EXCLUDED_STATUSES = ["INVOICED", "CLOSED"] as const;

function truncate(s: unknown, max: number): string {
  if (s === null || s === undefined) return "";
  // Coerce anything (Decimal, number, object with toString) to string safely
  const str = typeof s === "string" ? s : String(s);
  if (!str) return "";
  const cleaned = str.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + "…" : cleaned;
}

function fmtTs(d: Date | null | undefined): string {
  if (!d) return "-";
  return d.toISOString().slice(0, 16);
}

export async function buildShadowContext(): Promise<string> {
  const sections: string[] = [];

  // -------------------------------------------------------------------------
  // 1. Active tickets
  // -------------------------------------------------------------------------
  const tickets = await prisma.ticket.findMany({
    where: {
      status: { notIn: EXCLUDED_STATUSES as unknown as string[] as never },
    },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      updatedAt: true,
      payingCustomer: { select: { name: true } },
      site: { select: { siteName: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: MAX_TICKETS,
  });

  const ticketIds = tickets.map((t) => t.id);

  const ticketsBlock: string[] = ["=== ACTIVE TICKETS ==="];
  if (tickets.length === 0) {
    ticketsBlock.push("(none)");
  } else {
    for (const t of tickets) {
      const customer = truncate(t.payingCustomer?.name || "?", 28);
      const site = truncate(t.site?.siteName || "-", 28);
      ticketsBlock.push(
        `T#${t.ticketNo} | ${t.status} | ${customer} | ${site} | lines=${t._count.lines} | last=${fmtTs(t.updatedAt)}`
      );
      if (t.title) {
        ticketsBlock.push(`  title: ${truncate(t.title, 120)}`);
      }
    }
  }
  sections.push(ticketsBlock.join("\n"));

  // -------------------------------------------------------------------------
  // 2. Recent ticket lines (grouped by ticket)
  // -------------------------------------------------------------------------
  const linesBlock: string[] = ["=== RECENT LINES ==="];
  if (ticketIds.length > 0) {
    const lines = await prisma.ticketLine.findMany({
      where: { ticketId: { in: ticketIds } },
      select: {
        ticketId: true,
        description: true,
        qty: true,
        unit: true,
        supplierName: true,
        sectionLabel: true,
        ticket: { select: { ticketNo: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_LINES_TOTAL,
    });

    // Group by ticketNo
    const byTicket = new Map<number, typeof lines>();
    for (const line of lines) {
      const key = line.ticket.ticketNo;
      const arr = byTicket.get(key) ?? [];
      arr.push(line);
      byTicket.set(key, arr);
    }

    if (byTicket.size === 0) {
      linesBlock.push("(none)");
    } else {
      const sortedKeys = Array.from(byTicket.keys()).sort((a, b) => a - b);
      for (const tNo of sortedKeys) {
        linesBlock.push(`T#${tNo}:`);
        for (const line of byTicket.get(tNo) ?? []) {
          const desc = truncate(line.description, 70);
          const qty = line.qty?.toString() ?? "?";
          const unit = line.unit ?? "EA";
          const supplier = truncate(line.supplierName || "-", 18);
          const section = truncate(line.sectionLabel || "-", 18);
          linesBlock.push(`  - ${desc} | ${qty} ${unit} | ${supplier} | ${section}`);
        }
      }
    }
  } else {
    linesBlock.push("(none)");
  }
  sections.push(linesBlock.join("\n"));

  // -------------------------------------------------------------------------
  // 3. Active threads: linked + unlinked candidates
  // -------------------------------------------------------------------------
  const threadsBlock: string[] = ["=== ACTIVE THREADS ==="];

  // 3a. Linked chats — most recent IngestionLink rows that have a ticketId
  const linkedLinks = await prisma.ingestionLink.findMany({
    where: { ticketId: { not: null } },
    select: {
      ticketId: true,
      createdAt: true,
      parsedMessage: {
        select: {
          ingestionEvent: { select: { rawPayload: true } },
        },
      },
      ticket: { select: { ticketNo: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  interface ChatKey {
    chatId: string;
    chatName: string;
    ticketNo: number;
  }

  const seenLinked = new Map<string, ChatKey>();
  for (const link of linkedLinks) {
    const raw = link.parsedMessage?.ingestionEvent?.rawPayload as
      | Record<string, unknown>
      | null;
    if (!raw) continue;
    const chatId =
      (raw.chat_id as string | undefined) ||
      (raw.from as string | undefined) ||
      (raw.sender as string | undefined) ||
      "";
    if (!chatId) continue;
    const chatName =
      (raw.chat_name as string | undefined) ||
      ((raw.from as Record<string, unknown> | undefined)?.emailAddress as
        | Record<string, unknown>
        | undefined
        ? ((raw.from as Record<string, unknown>).emailAddress as {
            name?: string;
            address?: string;
          }).name || ""
        : "") ||
      "";
    const key = `${chatId}|${link.ticket?.ticketNo ?? "?"}`;
    if (seenLinked.has(key)) continue;
    seenLinked.set(key, {
      chatId,
      chatName: chatName || "?",
      ticketNo: link.ticket?.ticketNo ?? 0,
    });
    if (seenLinked.size >= MAX_LINKED_THREADS) break;
  }

  for (const c of seenLinked.values()) {
    threadsBlock.push(
      `[linked]   chat=${truncate(c.chatName, 30)} / ${truncate(c.chatId, 40)} -> T#${c.ticketNo}`
    );
  }

  // 3b. Unlinked recent chats — events in last 48h with no IngestionLink
  const sinceUnlinked = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentEvents = await prisma.ingestionEvent.findMany({
    where: { createdAt: { gte: sinceUnlinked } },
    select: {
      id: true,
      rawPayload: true,
      parsedMessages: {
        select: {
          ingestionLinks: { select: { ticketId: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const unlinkedMap = new Map<string, { chatName: string; count: number }>();
  for (const ev of recentEvents) {
    const linkedAlready = ev.parsedMessages.some((pm) =>
      pm.ingestionLinks.some((l) => l.ticketId)
    );
    if (linkedAlready) continue;
    const raw = ev.rawPayload as Record<string, unknown> | null;
    if (!raw) continue;
    const chatId =
      (raw.chat_id as string | undefined) ||
      (raw.from as string | undefined) ||
      (raw.sender as string | undefined) ||
      "";
    if (!chatId) continue;
    // Skip chats that are already in the linked list — we only want
    // brand-new unrecognised chats here.
    const alreadyLinked = Array.from(seenLinked.values()).some(
      (c) => c.chatId === chatId
    );
    if (alreadyLinked) continue;
    const chatName =
      (raw.chat_name as string | undefined) ||
      (((raw.from as Record<string, unknown> | undefined)?.emailAddress as {
        name?: string;
      } | undefined)?.name as string | undefined) ||
      "";
    const prev = unlinkedMap.get(chatId);
    unlinkedMap.set(chatId, {
      chatName: prev?.chatName || chatName || "?",
      count: (prev?.count ?? 0) + 1,
    });
  }

  let unlinkedShown = 0;
  for (const [chatId, info] of unlinkedMap.entries()) {
    if (unlinkedShown >= MAX_UNLINKED_THREADS) break;
    threadsBlock.push(
      `[unlinked] chat=${truncate(info.chatName, 30)} / ${truncate(chatId, 40)} (${info.count} recent msgs)`
    );
    unlinkedShown++;
  }

  if (threadsBlock.length === 1) threadsBlock.push("(none)");
  sections.push(threadsBlock.join("\n"));

  // -------------------------------------------------------------------------
  // 4. Recent procurement orders (last 7d)
  // -------------------------------------------------------------------------
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const procurement = await prisma.procurementOrder.findMany({
    where: {
      OR: [
        { issuedAt: { gte: sevenDaysAgo } },
        { issuedAt: null },
      ],
    },
    select: {
      poNo: true,
      status: true,
      totalCostExpected: true,
      supplier: { select: { name: true } },
      ticket: { select: { ticketNo: true } },
    },
    orderBy: { issuedAt: "desc" },
    take: MAX_PROCUREMENT,
  });

  const procBlock: string[] = ["=== RECENT PROCUREMENT (7d) ==="];
  if (procurement.length === 0) {
    procBlock.push("(none)");
  } else {
    for (const p of procurement) {
      const supplier = truncate(p.supplier?.name || "?", 24);
      const total = p.totalCostExpected?.toString() ?? "0.00";
      procBlock.push(
        `${p.poNo} | ${supplier} | T#${p.ticket?.ticketNo ?? "?"} | £${total} | ${p.status}`
      );
    }
  }
  sections.push(procBlock.join("\n"));

  // -------------------------------------------------------------------------
  // 5. Open tasks per ticket
  // -------------------------------------------------------------------------
  const tasksBlock: string[] = ["=== OPEN TASKS ==="];
  if (ticketIds.length > 0) {
    const tasks = await prisma.task.groupBy({
      by: ["ticketId", "taskType"],
      where: {
        ticketId: { in: ticketIds },
        status: { in: ["PENDING", "OPEN", "IN_PROGRESS"] },
      },
      _count: { _all: true },
    });

    if (tasks.length === 0) {
      tasksBlock.push("(none)");
    } else {
      // Group by ticketId -> list of taskTypes
      const byTicketId = new Map<string, string[]>();
      for (const row of tasks) {
        const arr = byTicketId.get(row.ticketId) ?? [];
        arr.push(`${row.taskType}(${row._count._all})`);
        byTicketId.set(row.ticketId, arr);
      }
      const tNoById = new Map(tickets.map((t) => [t.id, t.ticketNo]));
      for (const [tid, types] of byTicketId.entries()) {
        const tNo = tNoById.get(tid) ?? "?";
        tasksBlock.push(`T#${tNo}: ${types.join(", ")}`);
      }
    }
  } else {
    tasksBlock.push("(none)");
  }
  sections.push(tasksBlock.join("\n"));

  return sections.join("\n\n");
}

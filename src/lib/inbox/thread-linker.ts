/**
 * Thread auto-linker — idempotent sweep that re-scores InboxThreads which
 * never got a confident ticket link.
 *
 * Scope: threads where linkedTicketId IS NULL AND linkConfidence IS NULL or
 * LOW, and linkSource is not MANUAL. Runs after `classify` in run-all so:
 *   - freshly-classified threads get a second scoring pass;
 *   - existing null/LOW threads keep getting re-tried as new tickets,
 *     contacts, and content arrive.
 *
 * Scoring: delegates to autoLinkThread (shared with the live ingestion path
 * in thread-builder.ts), then layers one extra signal:
 *   "phone seen in ticket comms history" — if the thread's sender phone has
 *   already appeared on an open ticket's linked threads, suggest that ticket
 *   at MEDIUM confidence.
 */
import { prisma } from "@/lib/prisma";
import { autoLinkThread } from "@/lib/inbox/thread-builder";

type Channel = "EMAIL" | "WHATSAPP" | "WHATSAPP_GROUP" | "SMS" | "OTHER";

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  return d.length >= 7 ? d : null;
}

function isPhoneSender(s: string | null | undefined): boolean {
  if (!s) return false;
  return (
    s.includes("@c.us") ||
    s.includes("@s.whatsapp.net") ||
    /^\+?\d[\d\s\-()]{5,}$/.test(s)
  );
}

export interface RunThreadLinkerResult {
  scanned: number;
  high: number;
  medium: number;
  low: number;
  errors: number;
}

export async function runThreadLinker(
  opts: { limit?: number } = {}
): Promise<RunThreadLinkerResult> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  // Split filters into explicit AND: Prisma's `NOT: { linkSource: "MANUAL" }`
  // excludes rows where linkSource IS NULL (SQL three-valued logic), which
  // drops every auto-linked-null row from the sweep. Spell it out so nulls
  // are kept.
  const threads = await prisma.inboxThread.findMany({
    where: {
      linkedTicketId: null,
      AND: [
        { OR: [{ linkConfidence: null }, { linkConfidence: "LOW" }] },
        { OR: [{ linkSource: null }, { linkSource: { not: "MANUAL" } }] },
      ],
    },
    select: { id: true, channel: true, conversationKey: true },
    orderBy: { latestAt: "desc" },
    take: limit,
  });

  let scanned = 0, high = 0, medium = 0, low = 0, errors = 0;

  for (const t of threads) {
    try {
      const latest = await prisma.inboxThreadMessage.findFirst({
        where: { threadId: t.id },
        orderBy: { occurredAt: "desc" },
        select: { sender: true },
      });
      const sender = latest?.sender ?? null;

      await autoLinkThread(t.id, t.channel as Channel, t.conversationKey, sender);
      await phoneHistoryFallback(t.id, sender);

      const after = await prisma.inboxThread.findUnique({
        where: { id: t.id },
        select: { linkConfidence: true },
      });
      scanned++;
      if (after?.linkConfidence === "HIGH") high++;
      else if (after?.linkConfidence === "MEDIUM") medium++;
      else low++;
    } catch (err) {
      errors++;
      console.warn(
        `[thread-linker] thread ${t.id} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { scanned, high, medium, low, errors };
}

async function phoneHistoryFallback(
  threadId: string,
  sender: string | null
): Promise<void> {
  if (!isPhoneSender(sender)) return;
  const digits = phoneDigits(sender);
  if (!digits) return;

  const current = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    select: { linkedTicketId: true, linkSource: true },
  });
  if (!current) return;
  if (current.linkSource === "MANUAL") return;
  if (current.linkedTicketId) return;

  const histories = await prisma.inboxThreadMessage.findMany({
    where: {
      sender: { not: null },
      thread: {
        linkedTicketId: { not: null },
        linkedTicket: {
          status: { notIn: ["CLOSED", "INVOICED", "LOCKED"] },
        },
      },
    },
    select: {
      sender: true,
      thread: { select: { linkedTicketId: true } },
    },
    take: 5000,
  });

  const ticketsForPhone = new Set<string>();
  for (const h of histories) {
    const d = phoneDigits(h.sender);
    if (!d) continue;
    if (d === digits || d.endsWith(digits) || digits.endsWith(d)) {
      if (h.thread.linkedTicketId) ticketsForPhone.add(h.thread.linkedTicketId);
    }
  }

  if (ticketsForPhone.size !== 1) return;
  const [ticketId] = Array.from(ticketsForPhone);

  await prisma.inboxThread.update({
    where: { id: threadId },
    data: {
      linkedTicketId: ticketId,
      linkConfidence: "MEDIUM",
      linkSource: "AUTO",
    },
  });
}

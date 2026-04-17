/**
 * Supplier-RFQ thread linker.
 *
 * When Majid sends a WhatsApp/email to a supplier asking about a product
 * ("hey what's your price for Cat6 300m box?") OR a supplier replies on
 * a fresh thread, we want that thread linked to the matching open ticket
 * so the existing thread-appender takes over from the second message
 * onward.
 *
 * This module finds unlinked InboxThreads whose sender resolves to a
 * Supplier, scores each thread against open CAPTURED/PRICING/QUOTED
 * tickets by token overlap with line descriptions, and links the best
 * match with linkSource=AUTO, linkConfidence=MEDIUM.
 *
 * Conservative by design:
 *   - never overwrites a manual link (linkSource=MANUAL)
 *   - never links a thread that's already been triaged (status != NEW)
 *   - requires at least 40% of line tokens to appear in the thread text
 *   - if multiple tickets tie, picks the most recently active
 *   - skips tickets in manualMode
 */

import { prisma } from "@/lib/prisma";

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.com",
  "cromwellfreight.com", "cromwellplumbing.com",
]);

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "at",
  "with", "is", "are", "was", "were", "be", "been", "by", "as", "from",
  "that", "this", "it", "its", "your", "our", "we", "i", "you", "they",
  "please", "thanks", "thank", "regards", "hi", "hello", "hey", "good",
  "morning", "afternoon", "evening",
]);

interface SupplierMatch {
  supplierId: string;
  supplierName: string;
  via: "email_domain" | "supplier_email" | "supplier_phone" | "alias";
}

interface LinkReport {
  threadId: string;
  ticketId: string;
  ticketNo: number;
  supplierName: string;
  matchedTokens: string[];
  score: number;
}

export interface RfqLinkerResult {
  scanned: number;
  linked: LinkReport[];
  noMatch: number;
  errors: Array<{ threadId: string; error: string }>;
}

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  );
}

async function senderToSupplier(thread: {
  channel: string;
  conversationKey: string;
  participants: string[];
}): Promise<SupplierMatch | null> {
  // EMAIL: try direct supplier.email match first (cheapest hit), then
  // SupplierAlias on the domain.
  if (thread.channel === "EMAIL") {
    const senderEmails = (thread.participants || [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.includes("@"));

    for (const email of senderEmails) {
      const direct = await prisma.supplier.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (direct) return { supplierId: direct.id, supplierName: direct.name, via: "supplier_email" };
    }

    const domains = senderEmails
      .map((e) => e.split("@")[1])
      .filter((d): d is string => !!d && !GENERIC_DOMAINS.has(d));

    for (const domain of domains) {
      const alias = await prisma.supplierAlias.findFirst({
        where: { source: "EMAIL_DOMAIN", alias: { equals: domain, mode: "insensitive" } },
        select: { supplierId: true, supplier: { select: { name: true } } },
      });
      if (alias) {
        return { supplierId: alias.supplierId, supplierName: alias.supplier.name, via: "email_domain" };
      }
    }
    return null;
  }

  // WHATSAPP / SMS: phone-based match against Supplier.phone.
  if (thread.channel === "WHATSAPP" || thread.channel === "WHATSAPP_GROUP" || thread.channel === "SMS") {
    const localPart = thread.conversationKey.split("@")[0] ?? "";
    const digits = phoneDigits(localPart);
    if (!digits) return null;

    const candidates = await prisma.supplier.findMany({
      where: { phone: { not: null } },
      select: { id: true, name: true, phone: true },
    });
    for (const s of candidates) {
      const d = phoneDigits(s.phone);
      if (!d) continue;
      if (d === digits || d.endsWith(digits) || digits.endsWith(d)) {
        return { supplierId: s.id, supplierName: s.name, via: "supplier_phone" };
      }
    }
    return null;
  }

  return null;
}

async function buildThreadText(threadId: string): Promise<string> {
  const messages = await prisma.inboxThreadMessage.findMany({
    where: { threadId },
    orderBy: { occurredAt: "asc" },
    select: { ingestionEventId: true, snippet: true },
  });
  const eventIds = messages.map((m) => m.ingestionEventId);
  const parsed = eventIds.length
    ? await prisma.parsedMessage.findMany({
        where: { ingestionEventId: { in: eventIds } },
        select: { extractedText: true },
      })
    : [];
  const parts: string[] = [];
  for (const pm of parsed) if (pm.extractedText) parts.push(pm.extractedText.slice(0, 2000));
  if (parts.length === 0) return messages.map((m) => m.snippet ?? "").join("\n");
  return parts.join("\n\n");
}

interface ScoredCandidate {
  ticketId: string;
  ticketNo: number;
  score: number;
  matchedTokens: string[];
  lastActivityAt: Date;
}

async function findCandidateTickets(threadText: string, threadSubject: string | null): Promise<ScoredCandidate[]> {
  // Pull all open tickets in the relevant statuses with their line descriptions.
  // For a small / medium book this is fine; if it grows we can index.
  const openTickets = await prisma.ticket.findMany({
    where: {
      status: { in: ["CAPTURED", "PRICING", "QUOTED"] },
      manualMode: false,
    },
    select: {
      id: true,
      ticketNo: true,
      lastActivityAt: true,
      createdAt: true,
      lines: { select: { description: true } },
    },
  });

  const haystackTokens = tokenize(`${threadSubject ?? ""}\n${threadText}`);
  if (haystackTokens.size === 0) return [];

  const candidates: ScoredCandidate[] = [];
  for (const t of openTickets) {
    if (t.lines.length === 0) continue;

    // Use the union of all line description tokens as the "needle".
    const needleTokens = new Set<string>();
    for (const l of t.lines) {
      for (const tok of tokenize(l.description)) needleTokens.add(tok);
    }
    if (needleTokens.size === 0) continue;

    const matched: string[] = [];
    for (const tok of needleTokens) {
      if (haystackTokens.has(tok)) matched.push(tok);
    }
    const score = matched.length / needleTokens.size;
    if (score >= 0.4) {
      candidates.push({
        ticketId: t.id,
        ticketNo: t.ticketNo,
        score,
        matchedTokens: matched,
        lastActivityAt: t.lastActivityAt ?? t.createdAt,
      });
    }
  }

  // Highest score first; on tie, most recently active.
  candidates.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
      : b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
  );
  return candidates;
}

export async function runSupplierRfqLinker(opts: { limit?: number } = {}): Promise<RfqLinkerResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const threads = await prisma.inboxThread.findMany({
    where: {
      linkedTicketId: null,
      manualMode: false,
      status: { in: ["NEW", "TRIAGED"] },
    },
    select: {
      id: true,
      channel: true,
      conversationKey: true,
      participants: true,
      subject: true,
    },
    orderBy: { latestAt: "desc" },
    take: limit,
  });

  const result: RfqLinkerResult = { scanned: threads.length, linked: [], noMatch: 0, errors: [] };

  for (const thread of threads) {
    try {
      const supplier = await senderToSupplier(thread);
      if (!supplier) {
        result.noMatch++;
        continue;
      }

      const threadText = await buildThreadText(thread.id);
      const candidates = await findCandidateTickets(threadText, thread.subject);
      if (candidates.length === 0) {
        result.noMatch++;
        continue;
      }

      const winner = candidates[0];

      await prisma.$transaction(async (tx) => {
        await tx.inboxThread.update({
          where: { id: thread.id },
          data: {
            linkedTicketId: winner.ticketId,
            linkSource: "AUTO",
            linkConfidence: "MEDIUM",
            status: "LINKED",
          },
        });
        await tx.event.create({
          data: {
            ticketId: winner.ticketId,
            eventType: "SUPPLIER_RFQ_LINKED",
            timestamp: new Date(),
            notes: `Auto-linked supplier thread (${supplier.supplierName}) via ${supplier.via}. Token overlap: ${(winner.score * 100).toFixed(0)}% (${winner.matchedTokens.join(", ")})`,
          },
        });
      });

      result.linked.push({
        threadId: thread.id,
        ticketId: winner.ticketId,
        ticketNo: winner.ticketNo,
        supplierName: supplier.supplierName,
        matchedTokens: winner.matchedTokens,
        score: winner.score,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ threadId: thread.id, error: msg });
      console.error(`[supplier-rfq-linker] ${thread.id}:`, err);
    }
  }

  return result;
}

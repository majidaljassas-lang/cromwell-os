/**
 * Phase 12 — Auto-ticket creator.
 *
 * Processes AI-analysed InboxThreads and creates Tickets + TicketLines
 * for high-confidence commercial threads that don't match existing tickets.
 *
 * Flow per qualifying thread:
 *   1. Resolve customer from sender (contact → SiteContactLink → Customer)
 *   2. Resolve site from aiEntities.siteName
 *   3. Create Ticket with autoCreatedByAi = true
 *   4. Call AI to extract line items from thread text
 *   5. Create TicketLines (pre-structured, ready to price)
 *   6. Link thread → ticket
 *   7. Create REVIEW_AUTO_TICKET task
 *
 * Hard constraint: AI suggests, human decides. Every auto-created ticket
 * is flagged, reviewable, deletable, and editable.
 */

import { prisma } from "@/lib/prisma";
import { callClaude, isAiEnabled } from "@/lib/ai/anthropic";

// ── Types ───────────────────────────────────────────────────────────────────

interface ExtractedLine {
  description: string;
  qty: number;
  unit: "EA" | "M" | "LENGTH" | "PACK" | "LOT" | "SET";
}

interface AutoTicketReport {
  ticketId: string;
  ticketNo: number;
  title: string;
  customer: string;
  mode: string;
  linesCreated: number;
}

interface FlaggedThread {
  threadId: string;
  subject: string | null;
  aiSummary: string | null;
  aiConfidence: number | null;
}

export interface AutoCreateResult {
  ticketsCreated: AutoTicketReport[];
  flaggedForReview: FlaggedThread[];
  skipped: number;
  errors: string[];
}

// ── Noise filter: skip automated/system emails ─────────────────────────────

const NOISE_SENDERS = [
  "noreply", "no-reply", "no_reply",
  "donotreply", "do-not-reply", "do_not_reply",
  "paperless", "notification", "notifications",
  "automated", "mailer", "mailer-daemon",
  "bounce", "postmaster",
] as const;

const NOISE_SUBJECTS = [
  "unsubscribe", "newsletter",
  "automated message", "auto-reply", "auto reply",
  "out of office", "out-of-office",
  "delivery status notification",
  "read receipt",
] as const;

function isNoiseThread(participants: string[], subject: string | null): boolean {
  const sender = (participants[0] ?? "").toLowerCase();
  const subj = (subject ?? "").toLowerCase();
  if (NOISE_SENDERS.some((n) => sender.includes(n))) return true;
  if (NOISE_SUBJECTS.some((n) => subj.includes(n))) return true;
  return false;
}

// ── Classification → TicketMode mapping ─────────────────────────────────────

const COMMERCIAL_CLASSIFICATIONS = new Set([
  "ORDER",
  "QUOTE_REQUEST",
  "COMPETITIVE_BID",
  "SPEC_DRIVEN",
  "APPROVAL",
]);

function classificationToTicketMode(cls: string): string {
  switch (cls) {
    case "ORDER":           return "DIRECT_ORDER";
    case "APPROVAL":        return "DIRECT_ORDER";
    case "QUOTE_REQUEST":   return "PRICING_FIRST";
    case "COMPETITIVE_BID": return "COMPETITIVE_BID";
    case "SPEC_DRIVEN":     return "SPEC_DRIVEN";
    default:                return "DIRECT_ORDER";
  }
}

function classificationToTicketStatus(cls: string): string {
  switch (cls) {
    case "ORDER":    return "ORDERED";
    case "APPROVAL": return "APPROVED";
    default:         return "CAPTURED";
  }
}

// ── Customer resolution ─────────────────────────────────────────────────────

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

export async function resolveCustomer(
  thread: {
    channel: string;
    conversationKey: string;
    participants: string[];
    aiEntities: Record<string, unknown> | null;
  },
): Promise<{ customerId: string; customerName: string; autoCreated: boolean } | null> {
  // Strategy 1: Contact → SiteContactLink → Customer (same as inbox ACCEPT)
  let contactIds: string[] = [];

  if (thread.channel === "EMAIL") {
    const emails = (thread.participants || [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.includes("@"));
    if (emails.length > 0) {
      const contacts = await prisma.contact.findMany({
        where: { email: { in: emails, mode: "insensitive" }, isActive: true },
        select: { id: true },
      });
      contactIds = contacts.map((c) => c.id);
    }
  } else if (thread.channel === "WHATSAPP" || thread.channel === "SMS") {
    const localPart = thread.conversationKey.split("@")[0] ?? "";
    const digits = phoneDigits(localPart);
    if (digits) {
      const candidates = await prisma.contact.findMany({
        where: { phone: { not: null }, isActive: true },
        select: { id: true, phone: true },
      });
      contactIds = candidates
        .filter((c) => {
          const d = phoneDigits(c.phone);
          if (!d) return false;
          return d === digits || d.endsWith(digits) || digits.endsWith(d);
        })
        .map((c) => c.id);
    }
  }

  if (contactIds.length > 0) {
    const links = await prisma.siteContactLink.findMany({
      where: { contactId: { in: contactIds }, customerId: { not: null }, isActive: true },
      select: { customerId: true },
    });
    const customerIds = Array.from(new Set(links.map((l) => l.customerId!).filter(Boolean)));
    if (customerIds.length === 1) {
      const cust = await prisma.customer.findUnique({
        where: { id: customerIds[0] },
        select: { id: true, name: true },
      });
      if (cust) return { customerId: cust.id, customerName: cust.name, autoCreated: false };
    }
  }

  // Strategy 2: AI-extracted customerName → fuzzy match
  const aiName = (thread.aiEntities as Record<string, unknown> | null)?.customerName;
  if (typeof aiName === "string" && aiName.length >= 3) {
    const match = await prisma.customer.findFirst({
      where: { name: { contains: aiName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (match) return { customerId: match.id, customerName: match.name, autoCreated: false };
  }

  // Strategy 3: Email domain → Customer name
  if (thread.channel === "EMAIL") {
    const senderEmail = (thread.participants || [])[0] ?? "";
    const domain = senderEmail.split("@")[1]?.replace(/\.(co\.uk|com|org|net|ltd)$/g, "");
    if (domain && domain.length >= 3) {
      const match = await prisma.customer.findFirst({
        where: { name: { contains: domain, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (match) return { customerId: match.id, customerName: match.name, autoCreated: false };
    }
  }

  // No match across strategies 1-3. Do NOT auto-create a Customer — senders are
  // often buyers/contacts at existing customer organisations (e.g. an NHS buyer
  // emailing from a hospital). Auto-creating poisons reporting. Return null so
  // the caller can flag the thread for human triage instead.
  return null;
}

// ── Site resolution ─────────────────────────────────────────────────────────

export async function resolveSite(
  aiEntities: Record<string, unknown> | null,
): Promise<string | null> {
  const siteName = (aiEntities as Record<string, unknown> | null)?.siteName;
  if (typeof siteName !== "string" || siteName.length < 3) return null;

  const site = await prisma.site.findFirst({
    where: {
      OR: [
        { siteName: { contains: siteName, mode: "insensitive" } },
        { aliases: { has: siteName } },
      ],
      isActive: true,
    },
    select: { id: true },
  });
  return site?.id ?? null;
}

// ── AI line-item extraction ─────────────────────────────────────────────────

const LINE_EXTRACTION_PROMPT = `You are extracting product line items from a business communication for a UK construction materials supplier.

Extract every distinct product or material mentioned with its quantity. Return ONLY valid JSON with no markdown fences:
{
  "lines": [
    {
      "description": "product name and specification exactly as written",
      "qty": 1,
      "unit": "EA"
    }
  ]
}

Rules:
- description: the product/material name with specs (size, brand, type). Keep exactly as written. Do NOT add pricing.
- qty: the numeric quantity. If no quantity stated, use 1. If "320m" then qty=320 and unit="M".
- unit: one of EA (each/pieces/units/nr), M (metres/meters/m), LENGTH (lengths), PACK (packs), LOT (lots), SET (sets). Default EA.
- Extract ALL products mentioned, even single items
- Do NOT extract delivery charges, services, or non-product items
- If no products found, return {"lines": []}
- Combine duplicates: if same product appears twice, sum the quantities
- "75mm EFFAST PN16 pipe 320m" → {"description":"75mm EFFAST PN16 pipe","qty":320,"unit":"M"}
- "10 x 15mm copper elbows" → {"description":"15mm copper elbows","qty":10,"unit":"EA"}
- "2 packs Geberit 110mm soil pipe" → {"description":"Geberit 110mm soil pipe","qty":2,"unit":"PACK"}`;

export async function extractLineItems(threadText: string): Promise<ExtractedLine[]> {
  if (!isAiEnabled()) return [];
  if (threadText.trim().length < 30) return [];

  try {
    // Truncate to ~4000 tokens worth to control cost
    const truncated = threadText.slice(0, 16000);

    const result = await callClaude(LINE_EXTRACTION_PROMPT, truncated, {
      maxTokens: 1024,
      temperature: 0.1,
    });

    let jsonStr = result.text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as { lines: ExtractedLine[] };
    if (!Array.isArray(parsed.lines)) return [];

    const validUnits = new Set(["EA", "M", "LENGTH", "PACK", "LOT", "SET", "TONNE"]);

    return parsed.lines
      .filter((l) => l.description && typeof l.description === "string" && l.description.length > 0)
      .map((l) => ({
        description: l.description.slice(0, 500),
        qty: typeof l.qty === "number" && l.qty > 0 ? l.qty : 1,
        unit: validUnits.has(l.unit) ? l.unit : "EA",
      }));
  } catch (err) {
    console.warn("[auto-ticket-creator] Line extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Thread text builder ─────────────────────────────────────────────────────

export async function buildThreadText(threadId: string): Promise<string> {
  const messages = await prisma.inboxThreadMessage.findMany({
    where: { threadId },
    orderBy: { occurredAt: "asc" },
    select: { ingestionEventId: true, snippet: true },
  });

  const eventIds = messages.map((m) => m.ingestionEventId);
  if (eventIds.length === 0) return messages.map((m) => m.snippet ?? "").join("\n");

  const parsedMessages = await prisma.parsedMessage.findMany({
    where: { ingestionEventId: { in: eventIds } },
    select: { extractedText: true },
  });

  const parts: string[] = [];
  for (const pm of parsedMessages) {
    if (pm.extractedText) parts.push(pm.extractedText.slice(0, 4000));
  }

  // Fallback to snippets if no parsed text
  if (parts.length === 0) {
    return messages.map((m) => m.snippet ?? "").join("\n");
  }

  return parts.join("\n\n");
}

// ── Main runner ─────────────────────────────────────────────────────────────

export async function runAutoCreateTickets(
  opts: { limit?: number } = {},
): Promise<AutoCreateResult> {
  // Disabled per user instruction — customer + site must be allocated manually
  // via the inbox triage picker. Re-enable by removing this short-circuit.
  return { ticketsCreated: [], flaggedForReview: [], skipped: 0, errors: [] };

  // eslint-disable-next-line no-unreachable
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  // Find qualifying threads:
  // - status = NEW (not triaged/linked/noised/auto-ticketed)
  // - linkedTicketId IS NULL (no existing ticket match)
  // - manualMode = false
  // - aiConfidence IS NOT NULL (has been AI-analysed)
  // - aiClassification is commercial
  const threads = await prisma.inboxThread.findMany({
    where: {
      status: "NEW",
      linkedTicketId: null,
      manualMode: false,
      aiConfidence: { not: null },
      aiClassification: { in: Array.from(COMMERCIAL_CLASSIFICATIONS) },
    },
    select: {
      id: true,
      channel: true,
      conversationKey: true,
      participants: true,
      subject: true,
      aiClassification: true,
      aiConfidence: true,
      aiSummary: true,
      aiEntities: true,
      dealScore: true,
    },
    orderBy: { aiConfidence: "desc" },
    take: limit,
  });

  const result: AutoCreateResult = {
    ticketsCreated: [],
    flaggedForReview: [],
    skipped: 0,
    errors: [],
  };

  for (const thread of threads) {
    const confidence = thread.aiConfidence ?? 0;

    // ── Noise filter: skip automated/system emails ──
    if (isNoiseThread(thread.participants, thread.subject)) {
      result.skipped++;
      continue;
    }

    // ── Low confidence (50-74): flag for review, don't create ticket ──
    if (confidence < 75) {
      if (confidence >= 50) {
        // Boost dealScore so it surfaces at top of inbox
        const boostedScore = Math.min(100, (thread.dealScore ?? 0) + 30);
        await prisma.inboxThread.update({
          where: { id: thread.id },
          data: { dealScore: boostedScore },
        });
        result.flaggedForReview.push({
          threadId: thread.id,
          subject: thread.subject,
          aiSummary: thread.aiSummary,
          aiConfidence: confidence,
        });
      } else {
        result.skipped++;
      }
      continue;
    }

    // ── High confidence (>= 75): create ticket ──
    try {
      const customerResult = await resolveCustomer({
        channel: thread.channel,
        conversationKey: thread.conversationKey,
        participants: thread.participants,
        aiEntities: thread.aiEntities as Record<string, unknown> | null,
      });

      if (!customerResult) {
        // Customer can't be resolved from contact links, AI name match, or
        // email domain. Flag for human triage rather than auto-creating a
        // bogus Customer record.
        const boostedScore = Math.min(100, (thread.dealScore ?? 0) + 30);
        await prisma.inboxThread.update({
          where: { id: thread.id },
          data: { dealScore: boostedScore },
        });
        result.flaggedForReview.push({
          threadId: thread.id,
          subject: thread.subject,
          aiSummary: thread.aiSummary,
          aiConfidence: confidence,
        });
        continue;
      }

      const siteId = await resolveSite(thread.aiEntities as Record<string, unknown> | null);
      const classification = thread.aiClassification ?? "ORDER";
      const ticketMode = classificationToTicketMode(classification);
      const ticketStatus = classificationToTicketStatus(classification);
      const title = (thread.aiSummary ?? thread.subject ?? `Thread ${thread.id.slice(0, 8)}`).slice(0, 200);

      // Resolve siteCommercialLinkId if we have both customer and site
      let siteCommercialLinkId: string | undefined;
      if (siteId) {
        const link = await prisma.siteCommercialLink.findFirst({
          where: { customerId: customerResult.customerId, siteId, isActive: true },
          select: { id: true },
        });
        siteCommercialLinkId = link?.id;
      }

      // Build full thread text for line extraction BEFORE transaction
      const threadText = await buildThreadText(thread.id);
      const extractedLines = await extractLineItems(threadText);

      // Create ticket + lines + link + task in one transaction
      const ticket = await prisma.$transaction(async (tx) => {
        // 1. Create the ticket
        const newTicket = await tx.ticket.create({
          data: {
            title,
            description: thread.aiSummary ?? undefined,
            ticketMode: ticketMode as any,
            status: ticketStatus as any,
            payingCustomerId: customerResult.customerId,
            siteId: siteId ?? undefined,
            siteCommercialLinkId,
            autoCreatedByAi: true,
            manualMode: false,
            aiSummary: thread.aiSummary,
            revenueState: "OPERATIONAL",
          },
        });

        // 2. Create TicketLines from AI-extracted line items
        if (extractedLines.length > 0) {
          await tx.ticketLine.createMany({
            data: extractedLines.map((line) => ({
              ticketId: newTicket.id,
              lineType: "MATERIAL" as any,
              description: line.description,
              qty: line.qty,
              unit: line.unit as any,
              payingCustomerId: customerResult.customerId,
              siteId: siteId ?? undefined,
              siteCommercialLinkId,
              status: "CAPTURED" as any,
            })),
          });
        }

        // 3. Link thread → ticket
        await tx.inboxThread.update({
          where: { id: thread.id },
          data: {
            linkedTicketId: newTicket.id,
            linkSource: "AUTO",
            linkConfidence: "HIGH",
            status: "AUTO_TICKETED",
            autoCreatedTicket: true,
            triagedAt: new Date(),
          },
        });

        // 4. Create review task
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);

        await tx.task.create({
          data: {
            ticketId: newTicket.id,
            taskType: "REVIEW_AUTO_TICKET",
            priority: "MEDIUM",
            status: "OPEN",
            dueAt: endOfToday,
            generatedReason:
              `AI created this ticket from ${thread.channel.toLowerCase()}: "${thread.subject ?? "(no subject)"}". ` +
              `Classification: ${classification} (${confidence}% confidence). ` +
              `${extractedLines.length} line items extracted. ` +
              `Please review and confirm or delete.`,
          },
        });

        // 5. Create Event on the ticket for audit trail
        await tx.event.create({
          data: {
            ticketId: newTicket.id,
            eventType: "TICKET_CREATED",
            timestamp: new Date(),
            notes: `Auto-created by Phase 12 AI intake from ${thread.channel} thread. ${extractedLines.length} lines extracted.`,
          },
        });

        return newTicket;
      });

      result.ticketsCreated.push({
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        customer: customerResult.customerName,
        mode: ticketMode,
        linesCreated: extractedLines.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Thread ${thread.id}: ${msg}`);
      console.error(`[auto-ticket-creator] Failed for thread ${thread.id}:`, err);
    }
  }

  return result;
}

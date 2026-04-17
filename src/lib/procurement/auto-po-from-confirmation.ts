/**
 * Auto-create a ProcurementOrder when an outbound message looks like
 * Majid telling a supplier to proceed with the order.
 *
 * Trigger:
 *   - InboxThread linked to an open ticket (CAPTURED / PRICING)
 *   - thread sender (the other side) resolves to a Supplier
 *   - the most recent message on the thread is OUTBOUND from us
 *     (eventKind=OUTLOOK_SENT for email, rawPayload.is_outbound=true for WA)
 *   - the message contains confirmation language ("please supply",
 *     "go ahead", "yes please", "confirmed", etc.)
 *   - that supplier has at least one winning TicketLinePrice on this ticket
 *   - no ProcurementOrder for this ticket+supplier already exists
 *
 * Behaviour:
 *   - creates the PO with status="SENT", issuedAt=message.timestamp
 *   - copies winning prices for that supplier into ProcurementOrderLines
 *   - creates CostAllocation rows mirroring create-purchase-plan
 *   - creates Event PURCHASE_ORDER_SENT
 *   - creates a LOW-priority REVIEW_AUTO_PO task so Majid can spot wrong
 *     interpretations ("I said send me an updated quote, not the goods")
 *
 * Conservative: confirmation language must include a verb token AND the
 * thread must already have prices from this supplier — otherwise we
 * can't distinguish "ok please send a price" from "ok please send goods".
 */

import { prisma } from "@/lib/prisma";

interface AutoPoReport {
  ticketId: string;
  ticketNo: number;
  supplierId: string;
  supplierName: string;
  poId: string;
  poNo: string;
  lineCount: number;
  totalCost: number;
  triggeredBy: { threadId: string; messageId: string; channel: string };
}

export interface AutoPoResult {
  threadsScanned: number;
  posCreated: AutoPoReport[];
  noConfirmation: number;
  noWinningPrices: number;
  alreadyExists: number;
  errors: Array<{ threadId: string; error: string }>;
}

// Confirmation phrases — case-insensitive whole-word-ish matches.
// We look for at least one in the message body, AND a quantity hint
// (digit or "boxes/m/length/units" type token) somewhere nearby.
const CONFIRMATION_PHRASES: RegExp[] = [
  /\bplease\s+(?:supply|send|deliver|ship|proceed|raise|go\s+ahead)\b/i,
  /\bgo\s+ahead\b/i,
  /\bok(?:ay)?\s+please\s+(?:proceed|supply|send|deliver|ship)\b/i,
  /\byes\s+please\b/i,
  /\bconfirm(?:ed|ing)?\s+(?:the\s+)?order\b/i,
  /\bplace\s+the\s+order\b/i,
  /\braise\s+(?:the\s+)?(?:po|order)\b/i,
  /\bproceed\s+with\b/i,
  /\bcan\s+you\s+(?:supply|deliver|send|ship)\b/i,
  /\bwe(?:'ll|\s+will)\s+take\b/i,
];

const QUANTITY_HINT = /\b(\d+(?:\.\d+)?)\s*(?:x|×|of|boxes?|packs?|lengths?|m|metres?|meters?|pcs?|pieces?|rolls?|drums?)?\b/i;

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.com",
  "cromwellfreight.com", "cromwellplumbing.com",
]);

function looksLikeConfirmation(text: string): boolean {
  if (!text || text.length < 10) return false;
  const matched = CONFIRMATION_PHRASES.some((re) => re.test(text));
  if (!matched) return false;
  return QUANTITY_HINT.test(text);
}

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

async function resolveSupplierFromThread(thread: {
  channel: string;
  conversationKey: string;
  participants: string[];
}): Promise<{ id: string; name: string } | null> {
  if (thread.channel === "EMAIL") {
    const senderEmails = (thread.participants || [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.includes("@"));

    for (const email of senderEmails) {
      const direct = await prisma.supplier.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (direct) return direct;
    }

    const domains = senderEmails
      .map((e) => e.split("@")[1])
      .filter((d): d is string => !!d && !GENERIC_DOMAINS.has(d));
    for (const domain of domains) {
      const alias = await prisma.supplierAlias.findFirst({
        where: { source: "EMAIL_DOMAIN", alias: { equals: domain, mode: "insensitive" } },
        select: { supplierId: true, supplier: { select: { name: true } } },
      });
      if (alias) return { id: alias.supplierId, name: alias.supplier.name };
    }
    return null;
  }

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
        return { id: s.id, name: s.name };
      }
    }
  }

  return null;
}

async function isOutboundEvent(ingestionEventId: string): Promise<boolean> {
  const evt = await prisma.ingestionEvent.findUnique({
    where: { id: ingestionEventId },
    select: { eventKind: true, rawPayload: true },
  });
  if (!evt) return false;
  if (evt.eventKind === "OUTLOOK_SENT") return true;
  // WhatsApp inbound vs outbound is encoded in the raw payload.
  const payload = evt.rawPayload as Record<string, unknown> | null;
  if (payload && typeof payload === "object" && (payload as { is_outbound?: boolean }).is_outbound === true) {
    return true;
  }
  return false;
}

async function poNoForSupplier(supplierName: string): Promise<string> {
  const prefix = supplierName.replace(/[^a-zA-Z]/g, "").slice(0, 3).toUpperCase() || "PO";
  return `PO-${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

export async function runAutoPoFromConfirmation(opts: { limit?: number } = {}): Promise<AutoPoResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const threads = await prisma.inboxThread.findMany({
    where: {
      linkedTicketId: { not: null },
      manualMode: false,
      linkedTicket: {
        status: { in: ["CAPTURED", "PRICING"] },
        manualMode: false,
      },
    },
    select: {
      id: true,
      channel: true,
      conversationKey: true,
      participants: true,
      linkedTicketId: true,
      linkedTicket: {
        select: {
          id: true,
          ticketNo: true,
          procurementOrders: { select: { supplierId: true } },
          lines: {
            select: {
              id: true,
              description: true,
              qty: true,
              expectedCostUnit: true,
              expectedCostTotal: true,
              prices: {
                where: { isWinner: true },
                select: { id: true, supplierId: true, supplierName: true, costPerUnit: true, costTotal: true, leadTimeDays: true },
              },
            },
          },
        },
      },
    },
    orderBy: { latestAt: "desc" },
    take: limit,
  });

  const result: AutoPoResult = {
    threadsScanned: threads.length,
    posCreated: [],
    noConfirmation: 0,
    noWinningPrices: 0,
    alreadyExists: 0,
    errors: [],
  };

  for (const thread of threads) {
    if (!thread.linkedTicket) continue;
    try {
      const supplier = await resolveSupplierFromThread(thread);
      if (!supplier) continue;

      // Skip if a ProcurementOrder for this supplier+ticket already exists.
      if (thread.linkedTicket.procurementOrders.some((p) => p.supplierId === supplier.id)) {
        result.alreadyExists++;
        continue;
      }

      // Pull this thread's most recent OUTBOUND message and check its text.
      const messages = await prisma.inboxThreadMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { occurredAt: "desc" },
        select: { id: true, ingestionEventId: true, snippet: true, occurredAt: true },
        take: 10,
      });

      let confirmationMessage: { id: string; ingestionEventId: string; text: string; occurredAt: Date } | null = null;
      for (const msg of messages) {
        const outbound = await isOutboundEvent(msg.ingestionEventId);
        if (!outbound) continue;
        // Use parsed text where available, fall back to snippet.
        const parsed = await prisma.parsedMessage.findFirst({
          where: { ingestionEventId: msg.ingestionEventId },
          select: { extractedText: true },
        });
        const text = (parsed?.extractedText ?? msg.snippet ?? "").trim();
        if (looksLikeConfirmation(text)) {
          confirmationMessage = {
            id: msg.id,
            ingestionEventId: msg.ingestionEventId,
            text,
            occurredAt: msg.occurredAt,
          };
          break;
        }
      }

      if (!confirmationMessage) {
        result.noConfirmation++;
        continue;
      }

      // Build PO lines from this supplier's winning prices.
      const winningLines = thread.linkedTicket.lines
        .map((l) => {
          const win = l.prices.find((p) => p.supplierId === supplier.id);
          return win ? { line: l, win } : null;
        })
        .filter((x): x is { line: typeof thread.linkedTicket.lines[number]; win: typeof thread.linkedTicket.lines[number]["prices"][number] } => x !== null);

      if (winningLines.length === 0) {
        result.noWinningPrices++;
        continue;
      }

      const totalCost = winningLines.reduce((s, w) => s + Number(w.win.costTotal), 0);
      const poNo = await poNoForSupplier(supplier.name);

      const po = await prisma.$transaction(async (tx) => {
        const created = await tx.procurementOrder.create({
          data: {
            ticketId: thread.linkedTicket!.id,
            supplierId: supplier.id,
            poNo,
            status: "SENT",
            totalCostExpected: totalCost,
            issuedAt: confirmationMessage!.occurredAt,
            lines: {
              create: winningLines.map((w) => ({
                ticketLineId: w.line.id,
                description: w.line.description,
                qty: Number(w.line.qty),
                unitCost: Number(w.win.costPerUnit),
                lineTotal: Number(w.win.costTotal),
              })),
            },
          },
          include: { lines: true },
        });

        // CostAllocation per PO line — same shape as create-purchase-plan.
        for (const poLine of created.lines) {
          if (!poLine.ticketLineId) continue;
          await tx.costAllocation.create({
            data: {
              ticketLineId: poLine.ticketLineId,
              procurementOrderLineId: poLine.id,
              supplierId: supplier.id,
              qtyAllocated: poLine.qty,
              unitCost: poLine.unitCost,
              totalCost: poLine.lineTotal,
              allocationStatus: "MATCHED",
              confidenceScore: 90,
              notes: `Auto-allocated from ${created.poNo} (auto-PO from confirmation)`,
            },
          });
          await tx.ticketLine.update({
            where: { id: poLine.ticketLineId },
            data: { actualCostTotal: poLine.lineTotal },
          });
        }

        await tx.event.create({
          data: {
            ticketId: thread.linkedTicket!.id,
            eventType: "PURCHASE_ORDER_SENT",
            timestamp: confirmationMessage!.occurredAt,
            notes: `Auto-PO ${created.poNo} for ${supplier.name} — triggered by outbound confirmation message on thread ${thread.id}.`,
          },
        });

        // REVIEW task so Majid sees it
        const reviewDue = new Date();
        reviewDue.setHours(23, 59, 59, 999);
        await tx.task.create({
          data: {
            ticketId: thread.linkedTicket!.id,
            taskType: "REVIEW_AUTO_PO",
            priority: "LOW",
            status: "OPEN",
            dueAt: reviewDue,
            generatedReason:
              `System auto-created PO ${created.poNo} (£${totalCost.toFixed(2)}) for ${supplier.name} ` +
              `after detecting confirmation language in your ${thread.channel.toLowerCase()} message. ` +
              `Review and amend or cancel if the system misread your intent. ` +
              `Snippet: "${confirmationMessage!.text.slice(0, 200)}"`,
          },
        });

        return created;
      });

      result.posCreated.push({
        ticketId: thread.linkedTicket.id,
        ticketNo: thread.linkedTicket.ticketNo,
        supplierId: supplier.id,
        supplierName: supplier.name,
        poId: po.id,
        poNo: po.poNo,
        lineCount: po.lines.length,
        totalCost,
        triggeredBy: { threadId: thread.id, messageId: confirmationMessage.id, channel: thread.channel },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ threadId: thread.id, error: msg });
      console.error(`[auto-po-from-confirmation] ${thread.id}:`, err);
    }
  }

  return result;
}

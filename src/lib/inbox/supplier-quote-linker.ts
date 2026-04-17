/**
 * Phase 13 — Supplier-quote-linker.
 *
 * For each InboxThread that
 *   - is linked to an open ticket (CAPTURED / PRICING)
 *   - has a sender that resolves to a Supplier
 *   - has at least one inbound message we haven't yet processed for prices,
 * extract `(line description, qty?, unitCost, leadTimeDays?)` tuples from
 * the message text and turn them into TicketLinePrice rows on the matching
 * ticket lines. Then `recalcWinner()` per touched line.
 *
 * Two extraction passes:
 *   1. Regex (free, fast). Finds obvious "£1.50/m", "£450 per box", "£12 each"
 *      patterns alongside a product description on the same line.
 *   2. Claude (only if regex finds nothing AND ANTHROPIC_API_KEY is set).
 *      Tighter, used as a fallback for free-form supplier replies.
 *
 * Idempotent guards:
 *   - we record the latest InboxThreadMessage.id we've consumed in the
 *     thread's `lastSnippet` field (cheap; alternative would be a new
 *     column). Until we add a column, we use a per-process Set keyed by
 *     `(ticketLineId, supplierId, costPerUnit)` to avoid creating dup
 *     prices in the same run; cross-run dedup is handled by checking
 *     for an existing TicketLinePrice with same (ticketLineId, supplierId,
 *     costPerUnit) before insert.
 *   - `isManual=true` rows are NEVER touched.
 */

import { prisma } from "@/lib/prisma";
import { callClaude, isAiEnabled } from "@/lib/ai/anthropic";
import { recalcWinner } from "@/lib/finance/recalc-winner";

interface ExtractedPrice {
  /** Free-text product description as the supplier wrote it. */
  description: string;
  /** Cost per unit (excl VAT typically; we don't try to be smart about it). */
  unitCost: number;
  /** Optional supplier-stated qty — informational only. */
  qty?: number;
  /** Optional supplier-stated lead time (calendar days). */
  leadTimeDays?: number;
}

interface PriceCreatedReport {
  ticketId: string;
  ticketNo: number;
  ticketLineId: string;
  lineDescription: string;
  supplierId: string;
  supplierName: string;
  costPerUnit: number;
  source: "regex" | "ai";
}

export interface SupplierQuoteLinkerResult {
  threadsScanned: number;
  pricesCreated: PriceCreatedReport[];
  noExtraction: number;
  noLineMatch: number;
  errors: Array<{ threadId: string; error: string }>;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "at",
  "with", "is", "are", "was", "were", "by", "as", "from", "that", "this",
  "it", "its", "your", "our", "we", "you", "they", "please", "thanks",
  "thank", "regards", "hi", "hello", "hey",
]);

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

function bestLineMatch(
  description: string,
  lines: Array<{ id: string; description: string }>
): { lineId: string; score: number } | null {
  const needle = tokenize(description);
  if (needle.size === 0) return null;

  let best: { lineId: string; score: number } | null = null;
  for (const l of lines) {
    const hay = tokenize(l.description);
    let hits = 0;
    for (const tok of needle) if (hay.has(tok)) hits++;
    const score = hits / needle.size;
    if (!best || score > best.score) best = { lineId: l.id, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

// ── Regex pass ──────────────────────────────────────────────────────────────
//
// Looks for lines like:
//   "Cat6 utp 300m box - £150 each"
//   "75mm pipe £1.50/m, lead time 5 days"
//   "Soil pipe — £12.50 per length"
// We split on newlines and on common bullets/separators, then for each
// fragment we look for a £ amount. The fragment text minus the price
// becomes the description we try to match against ticket lines.

const PRICE_PATTERN = /£\s*([0-9]{1,6}(?:[.,][0-9]{1,4})?)/i;
const PER_UNIT_PATTERN = /(?:per|\/|each|ea\b|pp\b|\bbox\b|\bpack\b|\bm\b|metre|meter|length)/i;
const LEAD_TIME_PATTERN = /(\d{1,3})\s*(?:day|days|wk|week|weeks)\s*(?:lead|delivery|to deliver)?/i;

function extractWithRegex(text: string): ExtractedPrice[] {
  if (!text) return [];
  const fragments = text
    .split(/\r?\n|[•·]|(?:^|\s)-\s|\s+;\s+/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 6);

  const out: ExtractedPrice[] = [];
  for (const frag of fragments) {
    const priceMatch = frag.match(PRICE_PATTERN);
    if (!priceMatch) continue;

    const unitCost = parseFloat(priceMatch[1].replace(",", ""));
    if (!isFinite(unitCost) || unitCost <= 0) continue;

    // Heuristic guard: ignore amounts that look like phone numbers / refs
    // (no per-unit hint anywhere in the fragment AND the number is huge).
    if (unitCost > 100000 && !PER_UNIT_PATTERN.test(frag)) continue;

    const description = frag.replace(priceMatch[0], "").replace(PER_UNIT_PATTERN, " ").replace(/\s+/g, " ").trim();
    if (description.length < 3) continue;

    const leadMatch = frag.match(LEAD_TIME_PATTERN);
    const leadTimeDays = leadMatch ? parseInt(leadMatch[1], 10) : undefined;

    out.push({ description, unitCost, leadTimeDays });
  }
  return out;
}

// ── AI fallback ─────────────────────────────────────────────────────────────

const AI_SYSTEM_PROMPT = `You are extracting supplier-quoted prices from a UK construction materials supplier's reply message.

Return ONLY valid JSON, no markdown:
{
  "prices": [
    { "description": "string — product as the supplier wrote it", "unitCost": 0, "qty": 0, "leadTimeDays": 0 }
  ]
}

Rules:
- description: the product/material name with specs. Keep close to how the supplier wrote it. Do not invent specs.
- unitCost: the £ amount per unit (per metre, per box, per length, per piece). NUMBER, not a string. No currency symbol.
- qty (optional): only if the supplier stated a specific quantity offered.
- leadTimeDays (optional): integer days; convert weeks to days if needed.
- Skip totals, VAT-inclusive grand totals, delivery charges. We want PER-UNIT supplier costs only.
- If the message contains no quoted prices (it's a chase, a clarification, an "I'll get back to you"), return {"prices": []}.
- Combine duplicates: if same product appears twice, keep the cheaper one.`;

async function extractWithAi(text: string): Promise<ExtractedPrice[]> {
  if (!isAiEnabled()) return [];
  if (text.trim().length < 20) return [];

  try {
    const truncated = text.slice(0, 8000);
    const result = await callClaude(AI_SYSTEM_PROMPT, truncated, { maxTokens: 1024, temperature: 0.1 });
    let json = result.text.trim();
    const fence = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) json = fence[1].trim();

    const parsed = JSON.parse(json) as { prices?: ExtractedPrice[] };
    if (!Array.isArray(parsed.prices)) return [];

    return parsed.prices
      .filter((p) => p && typeof p.description === "string" && typeof p.unitCost === "number" && p.unitCost > 0)
      .map((p) => ({
        description: p.description.slice(0, 500),
        unitCost: p.unitCost,
        qty: typeof p.qty === "number" && p.qty > 0 ? p.qty : undefined,
        leadTimeDays: typeof p.leadTimeDays === "number" && p.leadTimeDays > 0 ? p.leadTimeDays : undefined,
      }));
  } catch (err) {
    console.warn("[supplier-quote-linker] AI extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Supplier resolution from thread participants ────────────────────────────

const GENERIC_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.co.uk", "outlook.com", "outlook.co.uk",
  "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "live.com",
  "cromwellfreight.com", "cromwellplumbing.com",
]);

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

// ── Main runner ─────────────────────────────────────────────────────────────

export async function runSupplierQuoteLinker(opts: { limit?: number } = {}): Promise<SupplierQuoteLinkerResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const threads = await prisma.inboxThread.findMany({
    where: {
      linkedTicketId: { not: null },
      manualMode: false,
      // The linked ticket must still be in a price-collecting state.
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
          lines: { select: { id: true, description: true } },
        },
      },
    },
    orderBy: { latestAt: "desc" },
    take: limit,
  });

  const result: SupplierQuoteLinkerResult = {
    threadsScanned: threads.length,
    pricesCreated: [],
    noExtraction: 0,
    noLineMatch: 0,
    errors: [],
  };

  for (const thread of threads) {
    if (!thread.linkedTicket) continue;
    try {
      const supplier = await resolveSupplierFromThread(thread);
      if (!supplier) continue;

      // Concatenate inbound message text. We deliberately include all
      // messages on the thread — re-runs are deduped by the
      // (ticketLineId, supplierId, costPerUnit) uniqueness check below.
      const messages = await prisma.inboxThreadMessage.findMany({
        where: { threadId: thread.id },
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
      const text =
        parsed.map((p) => p.extractedText ?? "").join("\n\n") ||
        messages.map((m) => m.snippet ?? "").join("\n");

      let extracted = extractWithRegex(text);
      let source: "regex" | "ai" = "regex";
      if (extracted.length === 0) {
        extracted = await extractWithAi(text);
        source = "ai";
      }

      if (extracted.length === 0) {
        result.noExtraction++;
        continue;
      }

      let matchedAny = false;
      const touchedLineIds = new Set<string>();

      for (const ex of extracted) {
        const match = bestLineMatch(ex.description, thread.linkedTicket.lines);
        if (!match) continue;
        matchedAny = true;

        // Dedup: skip if (line, supplier, exactly-same unitCost) already exists
        // and is not manual. Manual rows always retain their identity.
        const dup = await prisma.ticketLinePrice.findFirst({
          where: {
            ticketLineId: match.lineId,
            supplierId: supplier.id,
            costPerUnit: ex.unitCost,
          },
          select: { id: true, isManual: true },
        });
        if (dup) continue;

        const line = thread.linkedTicket.lines.find((l) => l.id === match.lineId);
        if (!line) continue;

        // costTotal needs the line qty — fetch it.
        const lineRow = await prisma.ticketLine.findUnique({
          where: { id: match.lineId },
          select: { qty: true, description: true },
        });
        if (!lineRow) continue;

        const qty = Number(lineRow.qty);
        const costTotal = Math.round(qty * ex.unitCost * 100) / 100;

        await prisma.ticketLinePrice.create({
          data: {
            ticketLineId: match.lineId,
            supplierName: supplier.name,
            supplierId: supplier.id,
            costPerUnit: ex.unitCost,
            costTotal,
            leadTimeDays: ex.leadTimeDays ?? null,
            notes: `Auto-extracted from supplier ${thread.channel.toLowerCase()} thread (${source}).`,
            isManual: false,
            isWinner: false,
          },
        });
        touchedLineIds.add(match.lineId);

        result.pricesCreated.push({
          ticketId: thread.linkedTicket.id,
          ticketNo: thread.linkedTicket.ticketNo,
          ticketLineId: match.lineId,
          lineDescription: lineRow.description,
          supplierId: supplier.id,
          supplierName: supplier.name,
          costPerUnit: ex.unitCost,
          source,
        });
      }

      if (!matchedAny) {
        result.noLineMatch++;
        continue;
      }

      // Recompute winners + flow costs to TicketLine for every line we touched.
      for (const lineId of touchedLineIds) await recalcWinner(lineId);

      // Single Event for audit (one per thread/run, not one per price).
      await prisma.event.create({
        data: {
          ticketId: thread.linkedTicket.id,
          eventType: "SUPPLIER_PRICES_EXTRACTED",
          timestamp: new Date(),
          notes: `Auto-extracted ${result.pricesCreated.filter((p) => p.ticketId === thread.linkedTicket!.id).length} price(s) from ${supplier.name} via ${source}.`,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ threadId: thread.id, error: msg });
      console.error(`[supplier-quote-linker] ${thread.id}:`, err);
    }
  }

  return result;
}

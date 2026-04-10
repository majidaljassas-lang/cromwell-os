/**
 * AI Shadow Engine (v1 — log-only, no mutations).
 *
 * Runs in the trickle-down chain. For every IngestionEvent from the
 * last 30 minutes that hasn't been analysed yet, ask Claude to:
 *   - classify the message (order / update / substitution / complaint / chat / …)
 *   - guess which active ticket it relates to (if any)
 *   - suggest what the user/system should do
 *   - surface any conflicts
 *
 * The result is stored as an Event row on the relevant ticket so the
 * user can audit everything. This is v1 — NO automated mutations of
 * tickets/lines. Mutations come in v2 once the user has reviewed how
 * the shadow reasons about real data.
 *
 * Gracefully inert: if ANTHROPIC_API_KEY is missing, returns a 200 with
 * `{ ok:true, skipped:true }` so trickle-down never breaks on us.
 */

import { prisma } from "@/lib/prisma";
import { callClaude, isAiEnabled, getModel, estimateTokens } from "@/lib/ai/anthropic";
import { buildShadowContext } from "@/lib/ai/build-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// ---------------------------------------------------------------------------
// Cost guardrails (hard limits — do not remove without a reason)
// ---------------------------------------------------------------------------
const MAX_EVENTS_PER_RUN = 20;
const MAX_BATCH_SIZE = 10;
const MAX_INPUT_TOKENS_PER_BATCH = 8000;
const MAX_OUTPUT_TOKENS = 2048;
const MAX_TOTAL_INPUT_TOKENS = 50_000;

const LOOKBACK_MINUTES = 30;

// ---------------------------------------------------------------------------
// System prompt (iterate on this as v1 outputs arrive)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the administrative shadow for Cromwell Plumbing Ltd, a UK plumbing and M&E contractor run by Majid. Your job is to read new messages (WhatsApp / email / supplier docs) as they arrive and propose what should happen on the operational system.

You see WhatsApp messages between Majid and his customers, site contacts, contractors and suppliers, plus emails from suppliers (order acknowledgements, invoices, cancellations, PODs). You are given a compact snapshot of the current operational state (active tickets, recent lines, known threads, recent procurement orders, open tasks).

Your output MUST be a single JSON object — no prose, no markdown fences. Shape:

{
  "events": [
    {
      "eventId": "<uuid of the ingestion event>",
      "eventSummary": "<one-line plain-English summary of what the message says>",
      "classification": "ORDER_ADD | ORDER_CHANGE | ORDER_CANCEL | SUBSTITUTION | SPEC_CHANGE | DELIVERY_UPDATE | SUPPLIER_ACK | SUPPLIER_INVOICE | PAYMENT | COMPLAINT | CHAT | UNKNOWN",
      "ticketRef": "T#<num> or null if no active ticket matches",
      "suggestedActions": ["short imperative bullets"],
      "conflicts": ["anything that looks wrong or inconsistent with current state"],
      "confidence": "high | medium | low"
    }
  ]
}

Rules:
- Be conservative. If uncertain, set confidence to "low" and put the uncertainty into "conflicts".
- NEVER invent prices, quantities or customer decisions that are not in the message.
- NEVER decide on the user's behalf — surface, don't decide.
- If a message looks like normal chit-chat (hi / thanks / ok / emoji) classify it as "CHAT" with empty suggestedActions.
- If you cannot match to an active ticket but the content is operational, set ticketRef to null and put "needs ticket routing" in suggestedActions.
- Prefer the exact ticket reference from the ACTIVE TICKETS block. Do not invent ticket numbers.
- Keep every string under 200 chars. Keep total output under 1500 tokens.
`;

// ---------------------------------------------------------------------------
// Types for parsed Claude output
// ---------------------------------------------------------------------------
interface ShadowEventResult {
  eventId: string;
  eventSummary: string;
  classification: string;
  ticketRef: string | null;
  suggestedActions: string[];
  conflicts: string[];
  confidence: "high" | "medium" | "low" | string;
}

interface ShadowResponse {
  events: ShadowEventResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function extractText(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as Record<string, unknown>;

  // WhatsApp
  const msg = r.message_text;
  if (typeof msg === "string" && msg.length > 0) return msg;

  // Email
  const subject =
    typeof r.subject === "string" ? (r.subject as string) : "";
  const body = r.body;
  let bodyText = "";
  if (typeof body === "string") {
    bodyText = body;
  } else if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.content === "string") bodyText = b.content;
    else if (typeof b.text === "string") bodyText = b.text;
  }
  if (subject || bodyText) {
    return `${subject}\n${bodyText}`.trim();
  }

  return "";
}

function senderLabel(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "?";
  const r = raw as Record<string, unknown>;
  if (typeof r.chat_name === "string" && r.chat_name) {
    return `${r.chat_name}${r.is_sent ? " (Majid)" : ""}`;
  }
  const from = r.from;
  if (from && typeof from === "object") {
    const f = from as Record<string, unknown>;
    const ea = f.emailAddress as Record<string, unknown> | undefined;
    if (ea) {
      const name =
        typeof ea.name === "string" ? (ea.name as string) : "";
      const address =
        typeof ea.address === "string" ? (ea.address as string) : "";
      return `${name || "?"} <${address || ""}>`;
    }
  }
  return "?";
}

function channelLabel(raw: unknown, sourceRecordType: string | null): string {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if ("chat_id" in r || "message_text" in r) return "whatsapp";
    if ("subject" in r || "from" in r) return "email";
  }
  return sourceRecordType || "unknown";
}

/**
 * Strip Markdown fences from Claude's response and parse JSON.
 */
function parseClaudeJson(raw: string): ShadowResponse | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  // Strip ```json … ``` fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  // Grab first {...} block if there's leading/trailing prose
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    cleaned = cleaned.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.events)) {
      return parsed as ShadowResponse;
    }
  } catch {
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function POST() {
  const started = Date.now();

  if (!isAiEnabled()) {
    console.warn("[ai-shadow] ANTHROPIC_API_KEY not set — skipping.");
    return Response.json(
      {
        ok: true,
        skipped: true,
        reason: "ANTHROPIC_API_KEY not set",
        durationMs: Date.now() - started,
      },
      { status: 200 }
    );
  }

  const errors: string[] = [];
  let eventsAnalysed = 0;
  let claudeMs = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let approxInputTokens = 0;

  try {
    // -----------------------------------------------------------------------
    // 1. Candidate events — last LOOKBACK_MINUTES, not yet analysed.
    // -----------------------------------------------------------------------
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000);
    const candidates = await prisma.ingestionEvent.findMany({
      where: { createdAt: { gte: since } },
      select: {
        id: true,
        sourceRecordType: true,
        rawPayload: true,
        createdAt: true,
        parsedMessages: {
          select: {
            id: true,
            extractedText: true,
            ingestionLinks: {
              select: {
                ticketId: true,
                ticket: { select: { ticketNo: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_EVENTS_PER_RUN * 4, // over-fetch so we can filter
    });

    if (candidates.length === 0) {
      return Response.json(
        {
          ok: true,
          eventsAnalysed: 0,
          claudeMs: 0,
          costEstimate: { inputTokens: 0, outputTokens: 0, model: getModel() },
          errors,
          durationMs: Date.now() - started,
        },
        { status: 200 }
      );
    }

    // -----------------------------------------------------------------------
    // 2. Filter out events already marked with an `[AI:<prefix>]` Event note.
    // -----------------------------------------------------------------------
    const idPrefixes = candidates.map((c) => `[AI:${c.id.slice(0, 8)}]`);
    const alreadyAnalysed = await prisma.event.findMany({
      where: {
        OR: idPrefixes.map((p) => ({ notes: { startsWith: p } })),
      },
      select: { notes: true },
    });
    const analysedPrefixes = new Set(
      alreadyAnalysed
        .map((e) => {
          const m = /^\[AI:([a-f0-9]{8})\]/i.exec(e.notes || "");
          return m ? m[1] : null;
        })
        .filter((x): x is string => !!x)
    );

    const fresh = candidates
      .filter((c) => !analysedPrefixes.has(c.id.slice(0, 8)))
      .slice(0, MAX_EVENTS_PER_RUN);

    if (fresh.length === 0) {
      return Response.json(
        {
          ok: true,
          eventsAnalysed: 0,
          claudeMs: 0,
          costEstimate: { inputTokens: 0, outputTokens: 0, model: getModel() },
          errors,
          durationMs: Date.now() - started,
          message: "No fresh events to analyse",
        },
        { status: 200 }
      );
    }

    // -----------------------------------------------------------------------
    // 3. Build shared context once per run.
    // -----------------------------------------------------------------------
    let contextBlob = "";
    try {
      contextBlob = await buildShadowContext();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`buildShadowContext: ${msg}`);
      contextBlob = "(context unavailable)";
    }

    // -----------------------------------------------------------------------
    // 4. Batch events and call Claude.
    // -----------------------------------------------------------------------
    for (let i = 0; i < fresh.length; i += MAX_BATCH_SIZE) {
      const batch = fresh.slice(i, i + MAX_BATCH_SIZE);

      // Render batch as compact text
      const rendered = batch
        .map((ev, idx) => {
          const text = (() => {
            // Prefer extracted text if we have it, else raw payload text.
            const parsed = ev.parsedMessages[0]?.extractedText;
            if (parsed && parsed.length > 0) return parsed;
            return extractText(ev.rawPayload);
          })();
          const sender = senderLabel(ev.rawPayload);
          const channel = channelLabel(ev.rawPayload, ev.sourceRecordType);
          const existingTicket = ev.parsedMessages
            .flatMap((pm) => pm.ingestionLinks)
            .find((l) => l.ticketId);
          const linkHint = existingTicket
            ? ` | linked=T#${existingTicket.ticket?.ticketNo ?? "?"}`
            : "";
          const snippet = (text || "(empty)").replace(/\s+/g, " ").trim().slice(0, 1500);
          return `--- EVENT ${idx + 1} ---\nid: ${ev.id}\nchannel: ${channel}${linkHint}\nfrom: ${sender}\nat: ${ev.createdAt.toISOString()}\ntext: ${snippet}`;
        })
        .join("\n\n");

      const userMessage = `CURRENT OPERATIONAL STATE:\n\n${contextBlob}\n\nNEW EVENTS TO ANALYSE:\n\n${rendered}\n\nReturn JSON only, matching the schema in the system prompt.`;

      const batchInputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userMessage);
      if (batchInputTokens > MAX_INPUT_TOKENS_PER_BATCH) {
        errors.push(
          `batch ${i / MAX_BATCH_SIZE}: skipped (est ${batchInputTokens} input tokens > cap ${MAX_INPUT_TOKENS_PER_BATCH})`
        );
        continue;
      }
      if (approxInputTokens + batchInputTokens > MAX_TOTAL_INPUT_TOKENS) {
        errors.push(
          `batch ${i / MAX_BATCH_SIZE}: bail — total input tokens would exceed ${MAX_TOTAL_INPUT_TOKENS}`
        );
        break;
      }
      approxInputTokens += batchInputTokens;

      let responseText = "";
      const callStart = Date.now();
      try {
        const result = await callClaude(SYSTEM_PROMPT, userMessage, {
          maxTokens: MAX_OUTPUT_TOKENS,
          temperature: 0.2,
        });
        responseText = result.text;
        if (typeof result.inputTokens === "number") {
          totalInputTokens += result.inputTokens;
        }
        if (typeof result.outputTokens === "number") {
          totalOutputTokens += result.outputTokens;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`claude batch ${i / MAX_BATCH_SIZE}: ${msg}`);
        claudeMs += Date.now() - callStart;
        continue;
      }
      claudeMs += Date.now() - callStart;

      const parsed = parseClaudeJson(responseText);
      if (!parsed) {
        errors.push(
          `claude batch ${i / MAX_BATCH_SIZE}: could not parse JSON response`
        );
        continue;
      }

      // ---------------------------------------------------------------------
      // 5. Log each inference as an Event row.
      // ---------------------------------------------------------------------
      for (const r of parsed.events) {
        try {
          // Match the result back to a candidate event by id
          const candidate = batch.find((b) => b.id === r.eventId);
          if (!candidate) continue;

          // Resolve ticketRef (e.g. "T#123") to a ticket id — prefer
          // an existing ingestion link; fall back to parsing the ref.
          let resolvedTicketId: string | null = null;
          const existingLink = candidate.parsedMessages
            .flatMap((pm) => pm.ingestionLinks)
            .find((l) => l.ticketId);
          if (existingLink?.ticketId) {
            resolvedTicketId = existingLink.ticketId;
          } else if (r.ticketRef && typeof r.ticketRef === "string") {
            const match = /T#(\d+)/i.exec(r.ticketRef);
            if (match) {
              const ticketNo = parseInt(match[1], 10);
              if (!Number.isNaN(ticketNo)) {
                const t = await prisma.ticket.findUnique({
                  where: { ticketNo },
                  select: { id: true },
                });
                if (t) resolvedTicketId = t.id;
              }
            }
          }

          // If we still have no ticket, we cannot insert an Event row
          // (Event.ticketId is required). Record in errors so it shows
          // up in the run summary — v2 will handle this differently.
          if (!resolvedTicketId) {
            errors.push(
              `event ${candidate.id.slice(0, 8)}: no ticket match (classification=${r.classification})`
            );
            eventsAnalysed++;
            continue;
          }

          const prefix = `[AI:${candidate.id.slice(0, 8)}]`;
          const actions = (r.suggestedActions || []).slice(0, 6).join("; ");
          const conflicts = (r.conflicts || []).slice(0, 6).join("; ");
          const notes = [
            `${prefix} ${r.eventSummary || "(no summary)"}`,
            `Classification: ${r.classification || "UNKNOWN"} (${r.confidence || "?"})`,
            actions ? `Suggested: ${actions}` : "",
            conflicts ? `Conflicts: ${conflicts}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          await prisma.event.create({
            data: {
              ticketId: resolvedTicketId,
              eventType: "AUTO_STATUS_PROGRESSED",
              timestamp: new Date(),
              sourceRef: `ai-shadow:${candidate.id}`,
              notes: notes.slice(0, 4000),
            },
          });

          eventsAnalysed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`persist: ${msg}`);
        }
      }
    }

    return Response.json(
      {
        ok: true,
        eventsAnalysed,
        claudeMs,
        costEstimate: {
          inputTokens: totalInputTokens || approxInputTokens,
          outputTokens: totalOutputTokens,
          model: getModel(),
        },
        errors,
        durationMs: Date.now() - started,
      },
      { status: 200 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-shadow] top-level failure:", msg);
    return Response.json(
      {
        ok: false,
        eventsAnalysed,
        claudeMs,
        errors: [...errors, msg],
        durationMs: Date.now() - started,
      },
      { status: 200 } // NEVER 500 — trickle-down must not break
    );
  }
}

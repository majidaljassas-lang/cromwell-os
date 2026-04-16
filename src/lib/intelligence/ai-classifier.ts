/**
 * Phase 12 — AI-powered thread classifier.
 *
 * Analyses InboxThread content via Claude and returns a structured
 * classification + entity extraction. Falls back to the keyword
 * classifier if AI is disabled or errors.
 *
 * Cost controls:
 *   - Skip if message text < 20 chars
 *   - Skip if thread.manualMode = true
 *   - Skip if aiAnalysedAt within last 24h AND no new messages since
 *   - Batch limit enforced by caller (default 20 per run)
 *   - Keyword pre-screen: if keyword confidence >= 80, skip AI
 */

import { prisma } from "@/lib/prisma";
import { callClaude, isAiEnabled, estimateTokens } from "@/lib/ai/anthropic";
import { classifyMessage } from "@/lib/ingestion/classifier";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AiClassificationResult {
  classification: string;
  confidence: number;
  summary: string;
  entities: {
    siteName: string | null;
    customerName: string | null;
    poRef: string | null;
    amounts: string[];
    products: string[];
    deliveryDate: string | null;
    contactIntent: string | null;
  };
}

export interface AiAnalyseResult {
  analysed: number;
  skippedManual: number;
  skippedRecent: number;
  skippedShort: number;
  skippedKeywordHigh: number;
  aiFailed: number;
  breakdown: Record<string, number>;
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analysing business communications for a UK construction materials supplier called Cromwell Plumbing Ltd. Analyse the message and return JSON.

Classification options:
ORDER — confirmed order for materials
QUOTE_REQUEST — request for pricing/quotation
COMPETITIVE_BID — competitive tender/bid request
SPEC_DRIVEN — specification or product selection
APPROVAL — approval of quote or order
DELIVERY_UPDATE — delivery notification or update
BILL_DOCUMENT — supplier invoice or bill
DISPUTE — complaint, error, or dispute
SCHEDULE — programme or timeline information
NOISE — automated, irrelevant, or non-commercial

Return ONLY valid JSON with no markdown fences:
{
  "classification": "string",
  "confidence": 0-100,
  "summary": "string (max 20 words, what they need)",
  "entities": {
    "siteName": "string or null",
    "customerName": "string or null",
    "poRef": "string or null",
    "amounts": ["£1,234"],
    "products": ["15mm copper fittings"],
    "deliveryDate": "YYYY-MM-DD or null",
    "contactIntent": "string or null"
  }
}`;

// ── Core classifier ─────────────────────────────────────────────────────────

/**
 * Classify a single thread via Claude. Returns the structured result,
 * or null if AI was skipped / failed (caller should fall back to keyword).
 */
export async function classifyThreadWithAi(
  threadId: string,
): Promise<AiClassificationResult | null> {
  if (!isAiEnabled()) return null;

  const thread = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    select: {
      subject: true,
      lastSnippet: true,
      manualMode: true,
      aiAnalysedAt: true,
      latestAt: true,
      messages: {
        orderBy: { occurredAt: "desc" },
        take: 3,
        select: {
          snippet: true,
          sender: true,
          ingestionEventId: true,
        },
      },
    },
  });
  if (!thread) return null;

  // Guard: manual mode
  if (thread.manualMode) return null;

  // Guard: already analysed recently and no new messages since
  if (thread.aiAnalysedAt) {
    const hoursSince = (Date.now() - thread.aiAnalysedAt.getTime()) / 3_600_000;
    const hasNewMessage = thread.latestAt > thread.aiAnalysedAt;
    if (hoursSince < 24 && !hasNewMessage) return null;
  }

  // Build the text payload from subject + latest 3 message snippets
  const parts: string[] = [];
  if (thread.subject) parts.push(`Subject: ${thread.subject}`);
  for (const msg of thread.messages) {
    const sender = msg.sender ? `[${msg.sender}]` : "";
    parts.push(`${sender} ${msg.snippet ?? ""}`.trim());
  }

  // Also pull full extractedText from the latest 3 IngestionEvents for richer context
  const eventIds = thread.messages.map((m) => m.ingestionEventId);
  if (eventIds.length > 0) {
    const parsedMessages = await prisma.parsedMessage.findMany({
      where: { ingestionEventId: { in: eventIds } },
      select: { extractedText: true },
      take: 3,
    });
    for (const pm of parsedMessages) {
      if (pm.extractedText && pm.extractedText.length > 0) {
        // Truncate each to 2000 chars to control token cost
        parts.push(pm.extractedText.slice(0, 2000));
      }
    }
  }

  const fullText = parts.join("\n\n");

  // Guard: too short
  if (fullText.trim().length < 20) return null;

  // Guard: keyword classifier is high-confidence on NON-COMMERCIAL types
  // (BILL_DOCUMENT, PO_DOCUMENT) — skip AI to save cost. For commercial
  // types that trigger ticket creation (ORDER, APPROVAL, QUOTE_REQUEST, etc.)
  // ALWAYS call Claude for proper summary + entity extraction, even if
  // keywords match — keyword matches produce garbage titles and no entities.
  const keywordResult = classifyMessage(fullText);
  const KEYWORD_ONLY_TYPES = new Set(["BILL_DOCUMENT", "PO_DOCUMENT", "DELIVERY_UPDATE"]);
  if (keywordResult.confidence >= 80 && KEYWORD_ONLY_TYPES.has(keywordResult.classification)) {
    return {
      classification: keywordResult.classification,
      confidence: keywordResult.confidence,
      summary: keywordResult.reasons.join("; "),
      entities: {
        siteName: null,
        customerName: null,
        poRef: null,
        amounts: [],
        products: [],
        deliveryDate: null,
        contactIntent: null,
      },
    };
  }

  // Guard: token budget — truncate extremely long messages (> ~8k tokens)
  const textForAi = estimateTokens(fullText) > 8000
    ? fullText.slice(0, 24000)
    : fullText;

  return callAiClassifier(textForAi);
}

async function callAiClassifier(text: string): Promise<AiClassificationResult | null> {
  try {
    const result = await callClaude(SYSTEM_PROMPT, text, {
      maxTokens: 512,
      temperature: 0.1,
    });

    // Parse the JSON response — Claude sometimes wraps in ```json fences
    let jsonStr = result.text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr) as AiClassificationResult;

    // Validate structure
    if (!parsed.classification || typeof parsed.confidence !== "number") {
      console.warn("[ai-classifier] Invalid AI response structure:", jsonStr.slice(0, 200));
      return null;
    }

    // Clamp confidence
    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence));

    // Ensure entities has all expected fields
    parsed.entities = {
      siteName: parsed.entities?.siteName ?? null,
      customerName: parsed.entities?.customerName ?? null,
      poRef: parsed.entities?.poRef ?? null,
      amounts: Array.isArray(parsed.entities?.amounts) ? parsed.entities.amounts : [],
      products: Array.isArray(parsed.entities?.products) ? parsed.entities.products : [],
      deliveryDate: parsed.entities?.deliveryDate ?? null,
      contactIntent: parsed.entities?.contactIntent ?? null,
    };

    return parsed;
  } catch (err) {
    console.warn("[ai-classifier] Claude call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Batch runner ────────────────────────────────────────────────────────────

/**
 * Analyse a batch of unanalysed InboxThreads. Called by
 * POST /api/automation/ai-analyse (step 11 in run-all).
 *
 * Targets threads where:
 *   - status IN (NEW, TRIAGED) — not already linked/noised/auto-ticketed
 *   - manualMode = false
 *   - aiAnalysedAt IS NULL, or latestAt > aiAnalysedAt (new message arrived)
 */
export async function runAiAnalyse(
  opts: { limit?: number } = {},
): Promise<AiAnalyseResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);

  const threads = await prisma.inboxThread.findMany({
    where: {
      status: { in: ["NEW", "TRIAGED"] },
      manualMode: false,
      OR: [
        { aiAnalysedAt: null },
        // Re-analyse if a new message arrived after last analysis.
        // Prisma doesn't support column-vs-column in where, so we
        // over-fetch and filter in memory below.
      ],
    },
    select: {
      id: true,
      aiAnalysedAt: true,
      latestAt: true,
      manualMode: true,
      lastSnippet: true,
    },
    orderBy: { latestAt: "desc" },
    take: limit * 2, // over-fetch to account for in-memory filtering
  });

  // In-memory filter: keep threads where aiAnalysedAt is null OR latestAt > aiAnalysedAt
  const candidates = threads.filter((t) => {
    if (t.manualMode) return false;
    if (!t.aiAnalysedAt) return true;
    return t.latestAt > t.aiAnalysedAt;
  }).slice(0, limit);

  const result: AiAnalyseResult = {
    analysed: 0,
    skippedManual: 0,
    skippedRecent: 0,
    skippedShort: 0,
    skippedKeywordHigh: 0,
    aiFailed: 0,
    breakdown: {},
  };

  for (const thread of candidates) {
    const aiResult = await classifyThreadWithAi(thread.id);

    if (!aiResult) {
      // Determine skip reason from the guards
      if (thread.manualMode) {
        result.skippedManual++;
      } else if ((thread.lastSnippet ?? "").length < 20) {
        result.skippedShort++;
      } else {
        result.aiFailed++;
      }
      continue;
    }

    // Persist AI results to the thread
    await prisma.inboxThread.update({
      where: { id: thread.id },
      data: {
        aiClassification: aiResult.classification,
        aiConfidence: aiResult.confidence,
        aiSummary: aiResult.summary,
        aiEntities: aiResult.entities as any,
        aiAnalysedAt: new Date(),
      },
    });

    result.analysed++;
    result.breakdown[aiResult.classification] = (result.breakdown[aiResult.classification] || 0) + 1;
  }

  return result;
}

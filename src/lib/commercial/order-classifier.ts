/**
 * Order Event Classifier
 *
 * Converts raw WhatsApp messages into structured OrderEvent candidates.
 * Each message is classified into an OrderEventType and product lines are extracted.
 *
 * Classification priority:
 * 1. CANCELLATION — explicit cancel/remove/don't need
 * 2. REDUCTION — less, reduce, take away, decrease
 * 3. SUBSTITUTION — instead, replace, swap, alternative
 * 4. ADDITION — also, extra, additional, add, as well, on top
 * 5. CONFIRMATION — confirm, approved, go ahead, yes please
 * 6. QUERY_ONLY — how much, price, quote, availability
 * 7. INITIAL_ORDER — order, need, send, supply, deliver, want, require + has product lines
 */

import { normalizeProduct, extractQtyUnit } from "@/lib/reconciliation/normalizer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ClassifiedMessage {
  messageId: string;
  sourceId: string;
  sender: string;
  timestamp: string;
  rawText: string;
  eventType: OrderEventTypeResult;
  confidence: number;
  reasons: string[];
  productLines: ExtractedProductLine[];
  isOrderRelevant: boolean;
  hasProductLines: boolean;
}

export type OrderEventTypeResult =
  | "INITIAL_ORDER"
  | "ADDITION"
  | "REDUCTION"
  | "SUBSTITUTION_OUT"
  | "SUBSTITUTION_IN"
  | "CANCELLATION"
  | "CONFIRMATION"
  | "QUERY_ONLY"
  | "NOT_ORDER";

export interface ExtractedProductLine {
  rawText: string;
  productCode: string | null;
  productName: string | null;
  category: string | null;
  qty: number;
  rawUom: string;
  confidence: number;
  lineIndex: number;
}

// ─── Keyword patterns ───────────────────────────────────────────────────────

const CANCELLATION_PATTERNS = [
  /\bcancel/i, /\bdon'?t\s+(?:need|want|order)/i, /\bremove\b/i,
  /\bscrap\b/i, /\bnot\s+needed/i, /\bforget\s+(?:about|the)/i,
  /\bno\s+longer\s+need/i,
];

const REDUCTION_PATTERNS = [
  /\breduc/i, /\bless\b/i, /\btake\s+away/i, /\bdecrease/i,
  /\btoo\s+(?:much|many)/i, /\bonly\s+need\s+\d/i,
  /\bchange.*(?:to|from)\s+\d/i, /\binstead\s+of\s+\d+.*(?:just|only)\s+\d/i,
];

const SUBSTITUTION_PATTERNS = [
  /\binstead\b/i, /\breplace/i, /\bswap/i, /\balternative/i,
  /\bsubstitut/i, /\brather\s+than/i, /\brather\s+have/i,
  /\bin\s+place\s+of/i, /\buse\s+.*\s+instead/i,
];

const ADDITION_PATTERNS = [
  /\balso\b/i, /\bextra\b/i, /\badditional/i, /\badd\b/i,
  /\bas\s+well/i, /\bon\s+top/i, /\bplus\b/i, /\band\s+also/i,
  /\bcan\s+(?:you|we)\s+(?:also|add)/i, /\bplease\s+add/i,
  /\bcan\s+I\s+(?:please\s+)?add/i, /\btop\s+up/i,
  /\bmore\b.*(?:of|please)/i,
];

const CONFIRMATION_PATTERNS = [
  /\bconfirm/i, /\bapprov/i, /\bgo\s+ahead/i, /\byes\s+please/i,
  /\bgood\s+to\s+go/i, /\ball\s+good/i, /\bthat'?s?\s+correct/i,
  /\bproceed/i, /\bok\s+(?:great|perfect|thanks)/i,
  /\bplease\s+go\s+ahead/i,
];

const QUERY_PATTERNS = [
  /\bhow\s+much/i, /\bprice\b/i, /\bquote\b/i, /\bavailab/i,
  /\bcan\s+you\s+(?:check|get)\s+(?:a\s+)?price/i,
  /\bwhat'?s?\s+the\s+(?:cost|price)/i, /\bdo\s+you\s+have/i,
  /\bstock\s+check/i,
];

const ORDER_PATTERNS = [
  /\border\b/i, /\bneed\b/i, /\bsend\b/i, /\bsupply\b/i,
  /\bdeliver/i, /\bwant\b/i, /\brequire/i, /\bplease\s+(?:get|send|order)/i,
  /\bcould\s+you\s+(?:please\s+)?order/i, /\bcan\s+you\s+(?:please\s+)?order/i,
  /\bwe\s+(?:will\s+)?(?:please\s+)?need/i,
  /\bfollowing\s+(?:materials|items|for)/i,
  /\bwill\s+need/i, /\bplease\s+(?:get|arrange|organise)/i,
];

// ─── Non-order filters ──────────────────────────────────────────────────────

const NOISE_PATTERNS = [
  /^‎?(?:image|video|audio|document|sticker|GIF|Contact card|location|Live location) omitted$/i,
  /^‎?(?:Voice call|Video call|Missed|You deleted|This message was deleted)/i,
  /^‎?Messages and calls are end-to-end encrypted/i,
  /^‎?\+?\d[\d\s-]{6,}$/,  // just a phone number
  /^https?:\/\//,           // just a URL
  /^[\u0600-\u06FF\s\u200F\u200E*{}()[\]|•\n\r]+$/,  // Arabic-only text
  /^\s*$/,                  // blank
];

// ─── Core Classifier ────────────────────────────────────────────────────────

export function classifyMessage(msg: {
  id: string;
  sourceId: string;
  sender: string;
  parsedTimestamp: string;
  rawText: string;
  messageType?: string;
}): ClassifiedMessage {
  const text = msg.rawText;
  const reasons: string[] = [];

  // Filter out noise
  if (isNoise(text)) {
    return buildResult(msg, "NOT_ORDER", 95, ["Noise/media/system message"], [], false);
  }

  // Very short messages without product content are unlikely orders
  const cleanText = text.replace(/[‎\u200E\u200F]/g, "").trim();
  if (cleanText.length < 10) {
    return buildResult(msg, "NOT_ORDER", 80, ["Message too short for order content"], [], false);
  }

  // Extract product lines
  const productLines = extractProductLines(text);
  const hasProducts = productLines.length > 0;

  // Score each classification
  let eventType: OrderEventTypeResult = "NOT_ORDER";
  let confidence = 0;

  // Check cancellation first (highest priority)
  const cancelScore = matchScore(text, CANCELLATION_PATTERNS);
  if (cancelScore > 0) {
    eventType = "CANCELLATION";
    confidence = 60 + cancelScore * 15;
    reasons.push(`Cancellation keywords matched (${cancelScore})`);
  }

  // Reduction
  const reductionScore = matchScore(text, REDUCTION_PATTERNS);
  if (reductionScore > 0 && reductionScore * 15 + 60 > confidence) {
    eventType = "REDUCTION";
    confidence = 60 + reductionScore * 15;
    reasons.push(`Reduction keywords matched (${reductionScore})`);
  }

  // Substitution
  const subScore = matchScore(text, SUBSTITUTION_PATTERNS);
  if (subScore > 0 && subScore * 15 + 60 > confidence) {
    eventType = "SUBSTITUTION_IN";
    confidence = 60 + subScore * 15;
    reasons.push(`Substitution keywords matched (${subScore})`);
  }

  // Addition
  const addScore = matchScore(text, ADDITION_PATTERNS);
  if (addScore > 0 && hasProducts && addScore * 15 + 55 > confidence) {
    eventType = "ADDITION";
    confidence = 55 + addScore * 15;
    reasons.push(`Addition keywords matched (${addScore})`);
  }

  // Confirmation
  const confScore = matchScore(text, CONFIRMATION_PATTERNS);
  if (confScore > 0 && confScore * 15 + 55 > confidence) {
    eventType = "CONFIRMATION";
    confidence = 55 + confScore * 15;
    reasons.push(`Confirmation keywords matched (${confScore})`);
  }

  // Query
  const queryScore = matchScore(text, QUERY_PATTERNS);
  if (queryScore > 0 && queryScore * 15 + 50 > confidence) {
    eventType = "QUERY_ONLY";
    confidence = 50 + queryScore * 15;
    reasons.push(`Query keywords matched (${queryScore})`);
  }

  // Initial order — requires product lines or strong order keywords
  const orderScore = matchScore(text, ORDER_PATTERNS);
  if (orderScore > 0 && hasProducts && orderScore * 10 + 60 > confidence) {
    eventType = "INITIAL_ORDER";
    confidence = 60 + orderScore * 10;
    reasons.push(`Order keywords matched (${orderScore}) with ${productLines.length} product lines`);
  }

  // If we have product lines but no classification yet, classify as INITIAL_ORDER
  if (eventType === "NOT_ORDER" && hasProducts && productLines.length >= 2) {
    eventType = "INITIAL_ORDER";
    confidence = 55;
    reasons.push(`${productLines.length} product lines detected — inferred as order`);
  }

  // If existing messageType from backlog parser gives hints
  if (msg.messageType === "ORDER" && eventType === "NOT_ORDER") {
    eventType = "INITIAL_ORDER";
    confidence = Math.max(confidence, 50);
    reasons.push("Pre-classified as ORDER by backlog parser");
  }
  if (msg.messageType === "CONFIRMATION" && eventType === "NOT_ORDER") {
    eventType = "CONFIRMATION";
    confidence = Math.max(confidence, 50);
    reasons.push("Pre-classified as CONFIRMATION by backlog parser");
  }

  // Boost confidence if product lines present alongside classification
  if (hasProducts && eventType !== "NOT_ORDER" && eventType !== "QUERY_ONLY") {
    confidence = Math.min(95, confidence + productLines.length * 3);
    reasons.push(`+${productLines.length * 3} confidence from ${productLines.length} product lines`);
  }

  const isOrderRelevant = eventType !== "NOT_ORDER";

  return buildResult(msg, eventType, Math.min(confidence, 95), reasons, productLines, isOrderRelevant);
}

// ─── Product Line Extraction ────────────────────────────────────────────────

export function extractProductLines(text: string): ExtractedProductLine[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const results: ExtractedProductLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip obvious non-product lines
    if (isNoise(line)) continue;
    if (line.length < 5) continue;
    if (/^[@‎\u200E]/.test(line)) continue;  // mentions, formatting
    if (/^https?:\/\//.test(line)) continue;  // URLs

    // Try extracting qty + unit
    const qtyUnit = extractQtyUnit(line);
    if (!qtyUnit) continue;

    // Try normalizing the product
    const normalized = normalizeProduct(line);
    const hasProduct = normalized.normalized !== "UNKNOWN";

    // Also try with just the text after the qty
    let productText = line;
    const qtyMatch = line.match(/^[•\-\s]*\d[\d,.]*\s*(?:No|no|nr|nos|pcs?|m|m2|x|×)?\s*(?:of\s+)?(.+)/i);
    if (qtyMatch) {
      productText = qtyMatch[1];
    }

    let productCode = normalized.normalized !== "UNKNOWN" ? normalized.normalized : null;
    let productName = normalized.normalized !== "UNKNOWN" ? normalized.normalized : null;
    let category = normalized.category !== "UNKNOWN" ? normalized.category : null;
    let confidence = normalized.confidence;

    // If main text didn't match, try the cleaned product text
    if (!productCode) {
      const cleaned = normalizeProduct(productText);
      if (cleaned.normalized !== "UNKNOWN") {
        productCode = cleaned.normalized;
        productName = cleaned.normalized;
        category = cleaned.category;
        confidence = cleaned.confidence;
      }
    }

    // If we have qty but no product, still include but mark low confidence
    if (!productCode) {
      confidence = 30;
      productName = productText.slice(0, 80);
    }

    results.push({
      rawText: line,
      productCode,
      productName,
      category,
      qty: qtyUnit.qty,
      rawUom: qtyUnit.unit,
      confidence,
      lineIndex: i,
    });
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isNoise(text: string): boolean {
  for (const pattern of NOISE_PATTERNS) {
    if (pattern.test(text.trim())) return true;
  }
  return false;
}

function matchScore(text: string, patterns: RegExp[]): number {
  let score = 0;
  for (const p of patterns) {
    if (p.test(text)) score++;
  }
  return score;
}

function buildResult(
  msg: { id: string; sourceId: string; sender: string; parsedTimestamp: string; rawText: string },
  eventType: OrderEventTypeResult,
  confidence: number,
  reasons: string[],
  productLines: ExtractedProductLine[],
  isOrderRelevant: boolean
): ClassifiedMessage {
  return {
    messageId: msg.id,
    sourceId: msg.sourceId,
    sender: msg.sender,
    timestamp: msg.parsedTimestamp,
    rawText: msg.rawText,
    eventType,
    confidence,
    reasons,
    productLines,
    isOrderRelevant,
    hasProductLines: productLines.length > 0,
  };
}

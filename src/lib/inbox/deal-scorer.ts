/**
 * Content-based deal-relevance scorer for InboxThread.
 *
 * Pure: takes text + the set of known site names and returns a score 0-100
 * with an explanation. No DB writes here. Reasons are kept short so they
 * fit in the inbox UI badge tooltip and the dealReasons[] persisted column.
 *
 * Signals (additive, capped at 100):
 *   PO reference        +30   "PO12345", "P/O 9999", "purchase order"
 *   Site mention        +25   substring match against any known Site.siteName / alias
 *   Amount              +15   "£1,234", "$999", "EUR 50.00", or "1,234.56 GBP"
 *   Product cue         +15   pipe sizes (15mm/22mm/etc.), copper/brass/MDPE/MLCP, fittings
 *   Quantity            +10   "10 x", "20 pcs", "5 lengths", "30 metres"
 *   Delivery cue        +10   "delivery", "dispatch", "ETA", "drop off", "arriving"
 *
 * Tier (caller computes — not stored as enum to avoid a migration):
 *   HIGH   ≥ 70  → auto-surface, prompt to ACCEPT
 *   MEDIUM ≥ 40  → surface for review
 *   LOW    < 40  → bottom of queue, not hidden
 */

export interface DealScoringInput {
  text: string;
  subject?: string | null;
  knownSiteNames: string[]; // siteName + each alias, lowercased
}

export interface DealScoreResult {
  score: number;
  reasons: string[];
}

const PO_PATTERN = /\b(?:p[\s./-]?o[\s.#:-]*\d{3,}|purchase\s*order\s*[#:]?\s*\d{3,})/i;
const AMOUNT_PATTERN = /(?:£|\$|€|\bgbp\b|\busd\b|\beur\b)\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:[,\s]\d{3})*(?:\.\d{1,2})?\s*(?:gbp|usd|eur)\b/i;
const PRODUCT_PATTERN = /\b\d{1,3}\s*mm\b|\bcopper\b|\bbrass\b|\bmlcp\b|\bmdpe\b|\bpex\b|\bpressfit\b|\bpipe(?:s|work)?\b|\bvalve\b|\bfitting\b|\bcoupler\b|\belbow\b|\btee\b|\bcylinder\b|\bcistern\b|\bradiator\b|\bboiler\b|\bcompression\b/i;
const QUANTITY_PATTERN = /\b\d{1,4}\s*(?:x|×|pcs|pieces?|units?|each|lengths?|nr|no\.?|m\b|metres?|meters?|kg|tonnes?|bags?|boxes?|packs?|pallets?)\b/i;
const DELIVERY_PATTERN = /\b(?:deliver(?:y|ies|ed|ing)?|dispatch(?:ed|ing)?|shipped|shipping|eta\b|drop[-\s]?off|arriving|collection|collect)\b/i;

export function scoreDealRelevance(input: DealScoringInput): DealScoreResult {
  const text = `${input.subject ?? ""}\n${input.text ?? ""}`;
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (PO_PATTERN.test(text)) {
    score += 30;
    reasons.push("PO reference");
  }

  // Site mention — match any known site name as a substring (cheap, false-
  // positive risk is low because site names are distinctive). Take the first
  // hit so the reason stays short.
  for (const name of input.knownSiteNames) {
    if (name.length < 4) continue; // skip overly-short names
    if (lower.includes(name)) {
      score += 25;
      reasons.push(`Site: ${name}`);
      break;
    }
  }

  if (AMOUNT_PATTERN.test(text)) {
    score += 15;
    reasons.push("Amount");
  }

  if (PRODUCT_PATTERN.test(text)) {
    score += 15;
    reasons.push("Product");
  }

  if (QUANTITY_PATTERN.test(text)) {
    score += 10;
    reasons.push("Quantity");
  }

  if (DELIVERY_PATTERN.test(text)) {
    score += 10;
    reasons.push("Delivery");
  }

  return { score: Math.min(100, score), reasons };
}

export function dealTier(score: number): "HIGH" | "MEDIUM" | "LOW" {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

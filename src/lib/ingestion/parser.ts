/**
 * Ingestion Parser
 *
 * Extracts structured data from raw payloads.
 * Source-specific parsers below, shared entity extraction here.
 */

export interface ParsedEntity {
  entityType: string;
  value: string;
  normalizedValue?: string;
  confidence: number;
  spanStart?: number;
  spanEnd?: number;
}

export interface ParsedLineCandidate {
  description: string;
  qty?: number;
  unit?: string;
  unitCost?: number;
  lineTotal?: number;
  productCode?: string;
}

export interface ParseResult {
  text: string;
  messageType: string;
  entities: ParsedEntity[];
  lineCandidates: ParsedLineCandidate[];
  monetaryValues: { value: number; context: string }[];
  structuredData: Record<string, unknown>;
}

// ─── Entity Extraction ──────────────────────────────────────────────────────

const MONEY_REGEX = /£([\d,]+\.?\d{0,2})/g;
const PHONE_REGEX = /(?:0|\+44)\s*\d[\d\s]{8,12}/g;
const EMAIL_REGEX = /[\w.-]+@[\w.-]+\.\w{2,}/g;
const POSTCODE_REGEX = /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/gi;
const QTY_UNIT_REGEX = /(\d+)\s*(?:x|×|no|nos|nr|pcs?|sets?|lengths?|m|metres?|meters?)\b/gi;

export function extractEntities(text: string): ParsedEntity[] {
  const entities: ParsedEntity[] = [];

  // Money
  let match;
  while ((match = MONEY_REGEX.exec(text)) !== null) {
    entities.push({
      entityType: "MONETARY_VALUE",
      value: match[0],
      normalizedValue: match[1].replace(/,/g, ""),
      confidence: 90,
      spanStart: match.index,
      spanEnd: match.index + match[0].length,
    });
  }

  // Phone numbers
  while ((match = PHONE_REGEX.exec(text)) !== null) {
    entities.push({
      entityType: "PHONE",
      value: match[0].trim(),
      normalizedValue: match[0].replace(/\s/g, ""),
      confidence: 80,
      spanStart: match.index,
      spanEnd: match.index + match[0].length,
    });
  }

  // Emails
  while ((match = EMAIL_REGEX.exec(text)) !== null) {
    entities.push({
      entityType: "EMAIL",
      value: match[0],
      confidence: 95,
      spanStart: match.index,
      spanEnd: match.index + match[0].length,
    });
  }

  // Postcodes (potential site indicator)
  while ((match = POSTCODE_REGEX.exec(text)) !== null) {
    entities.push({
      entityType: "POSTCODE",
      value: match[0].toUpperCase(),
      normalizedValue: match[0].toUpperCase().replace(/\s+/, " "),
      confidence: 85,
      spanStart: match.index,
      spanEnd: match.index + match[0].length,
    });
  }

  // Quantities
  while ((match = QTY_UNIT_REGEX.exec(text)) !== null) {
    entities.push({
      entityType: "QUANTITY",
      value: match[0],
      normalizedValue: match[1],
      confidence: 70,
      spanStart: match.index,
      spanEnd: match.index + match[0].length,
    });
  }

  return entities;
}

export function extractMonetaryValues(text: string): { value: number; context: string }[] {
  const results: { value: number; context: string }[] = [];
  let match;
  const regex = /£([\d,]+\.?\d{0,2})/g;
  while ((match = regex.exec(text)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, ""));
    const start = Math.max(0, match.index - 30);
    const end = Math.min(text.length, match.index + match[0].length + 30);
    const context = text.slice(start, end).trim();
    results.push({ value, context });
  }
  return results;
}

export function extractLineCandidates(text: string): ParsedLineCandidate[] {
  // Look for patterns like "10 x Basin Mixer Tap @ £45.00"
  const candidates: ParsedLineCandidate[] = [];
  const linePattern = /(\d+)\s*(?:x|×|no)\s+(.+?)\s*(?:@|at)\s*£([\d,.]+)/gi;
  let match;
  while ((match = linePattern.exec(text)) !== null) {
    const qty = parseInt(match[1]);
    const unitCost = parseFloat(match[3].replace(/,/g, ""));
    candidates.push({
      description: match[2].trim(),
      qty,
      unitCost,
      lineTotal: qty * unitCost,
    });
  }
  return candidates;
}

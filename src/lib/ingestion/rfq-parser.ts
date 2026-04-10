/**
 * RFQ Extraction Engine
 *
 * Parses free-text RFQ blobs into structured line candidates.
 * Rules-based extraction — AI assist can be layered later.
 *
 * Handles formats:
 *   "6x coupling 40mm solvent"
 *   "10 No 15mm copper pipe 3m lengths"
 *   "Basin Mixer Tap Chrome x 20"
 *   "- 8nr Thermostatic Shower Valve"
 *   Lines separated by newlines, commas, or numbered lists
 */

export interface ExtractedCandidate {
  rawText: string;
  qty: number | null;
  unit: string | null;
  product: string;
  size: string | null;
  spec: string | null;
  lineType: string;
  confidence: number;
}

// Quantity patterns: "6x", "10 No", "x 20", "8nr", "qty: 5", "40 meters of 22 mm"
const QTY_PATTERNS = [
  /^(\d+)\s*(?:meters?|metres?|m)\s+of\s+/i, // "40 meters of 22mm" — qty 40, unit M
  /^(\d+)\s*[xX×]\s+/,                    // "6x coupling"
  /^(\d+)\s*(?:no|nr|nos|pcs?|off)\s+/i,  // "10 No 15mm"
  /^-?\s*(\d+)\s*(?:no|nr|nos|pcs?|off)\s+/i, // "- 8nr valve"
  /\s+[xX×]\s*(\d+)\s*$/,                 // "valve x 20"
  /^(\d+)\s+/,                             // "10 basin mixer" (qty at start)
  /(?:qty|quantity)[\s:]*(\d+)/i,          // "qty: 5"
];

// Size patterns
const SIZE_PATTERNS = [
  /(\d+(?:\.\d+)?)\s*mm\b/i,              // "15mm", "22.5mm"
  /(\d+(?:\.\d+)?)\s*(?:inch|")\b/i,      // "1 inch", '1"'
  /(\d+)\s*[mM]\s+(?:length|coil)/i,      // "3m length"
  /(\d+\/\d+)\s*(?:inch|"|\s)/i,          // "1/2 inch"
  /\b(DN\d+)\b/i,                          // "DN15"
];

// Unit hints
const UNIT_HINT_PATTERNS: Array<[RegExp, string]> = [
  [/\blengths?\b/i, "LENGTH"],
  [/\bcoils?\b/i, "LENGTH"],
  [/\bmetres?\b/i, "M"],
  [/\bmeters?\b/i, "M"],
  [/\bpacks?\b/i, "PACK"],
  [/\bboxe?s?\b/i, "PACK"],
  [/\bsets?\b/i, "SET"],
  [/\bkits?\b/i, "SET"],
  [/\bpairs?\b/i, "SET"],
  [/\blot\b/i, "LOT"],
  [/\bpackage\b/i, "LOT"],
  [/\brolls?\b/i, "EA"],
  [/\btins?\b/i, "EA"],
];

// Material type keywords
const MATERIAL_KEYWORDS = [
  "pipe", "fitting", "valve", "tap", "mixer", "waste", "trap", "coupling",
  "elbow", "tee", "reducer", "adapter", "connector", "flange", "bracket",
  "clip", "screw", "bolt", "washer", "seal", "gasket", "solder", "flux",
  "copper", "cooper", "chrome", "brass", "pvc", "mlcp", "mdpe", "upvc", "solvent",
  "cement", "ptfe", "silicone", "radiator", "cylinder", "boiler",
  "thermostat", "shower", "basin", "bath", "toilet", "cistern",
  "press", "compression", "lbv", "motorised", "bypass", "lever",
  "insulation", "band", "ring", "reduced", "hole",
];

export function extractRfqCandidates(rawText: string): ExtractedCandidate[] {
  // Split into line candidates
  const lines = splitIntoLines(rawText);
  const candidates: ExtractedCandidate[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3) continue;
    if (isNonProductLine(trimmed)) continue;

    const candidate = parseLine(trimmed);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function splitIntoLines(text: string): string[] {
  // Split on newlines first
  let lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // If only 1 line, try splitting on commas
  if (lines.length <= 2) {
    const commaSplit = text.split(/,\s*/).map((l) => l.trim()).filter(Boolean);
    if (commaSplit.length > 2) lines = commaSplit;
  }

  // If still 1 line, try splitting on "Nx " pattern boundaries
  // This handles continuous text like "6x coupling 40mm 8x adapter 15mm 10x pipe"
  if (lines.length <= 2) {
    const qtyBoundary = text.split(/(?=\b\d+\s*[xX×]\s)/);
    const filtered = qtyBoundary.map((l) => l.trim()).filter((l) => l.length > 2);
    if (filtered.length > 2) lines = filtered;
  }

  // If still 1 line, try splitting on numbered patterns "1. ... 2. ..."
  if (lines.length <= 2) {
    const numbered = text.split(/(?:\d+[.)]\s*)/).filter((l) => l.trim().length > 2);
    if (numbered.length > 2) lines = numbered;
  }

  // Handle bullet points and dashes within each line
  const expanded: string[] = [];
  for (const line of lines) {
    const bulletSplit = line.split(/\s*[-•]\s+/).filter((l) => l.trim().length > 2);
    if (bulletSplit.length > 1) {
      expanded.push(...bulletSplit);
    } else {
      expanded.push(line);
    }
  }

  // CRITICAL: explode any single line that contains multiple item markers
  // Two patterns we explode on:
  //  (A) "N x SIZE..." — e.g. "20 x 15mm straight coupling 20 x 22mm elbows"
  //  (B) "N (meters|metres|m) of NN mm" — e.g. "40 meters of 22 mm 40 meters of 15 mm"
  const finalLines: string[] = [];
  for (const line of expanded) {
    const xMatches = line.match(/\b\d+\s*[xX×]\s+\d/g);
    const mOfMatches = line.match(/\b\d+\s*(?:meters?|metres?|m)\s+of\s+\d/gi);
    const totalMarkers = (xMatches?.length || 0) + (mOfMatches?.length || 0);

    if (totalMarkers >= 2) {
      // Split BEFORE either kind of boundary
      const fragments = line.split(/(?=\b\d+\s*(?:[xX×]|meters?|metres?|m)\s+(?:of\s+)?\d)/);
      for (const frag of fragments) {
        const t = frag.trim();
        if (t.length > 2) finalLines.push(t);
      }
    } else {
      finalLines.push(line);
    }
  }

  // Only strip numbered list prefixes like "1. " or "2) " — NOT "6x" qty prefixes
  return finalLines
    .map((l) => l.replace(/^(\d+)[.)]\s+/, "").replace(/^[•\-*]\s*/, "").trim())
    .filter((l) => l.length > 2);
}

function parseLine(rawText: string): ExtractedCandidate | null {
  let text = rawText;
  let qty: number | null = null;
  let unit: string | null = null;

  // Extract quantity
  for (const pattern of QTY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      qty = parseInt(match[1]);
      // Remove matched qty from text
      text = text.replace(pattern, "").trim();
      break;
    }
  }

  // Extract size
  let size: string | null = null;
  for (const pattern of SIZE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      size = match[0].trim();
      break;
    }
  }

  // Extract unit hints from text using word-boundary patterns
  for (const [pattern, uom] of UNIT_HINT_PATTERNS) {
    if (pattern.test(text)) {
      unit = uom;
      break;
    }
  }
  if (!unit) unit = "EA";

  // Clean product text
  const product = text
    .replace(/^\s*[-•*]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (product.length < 2) return null;

  // Determine line type
  const lineType = isMaterialLine(product) ? "MATERIAL" : "SERVICE";

  // Calculate confidence
  let confidence = 40;
  if (qty) confidence += 20;
  if (size) confidence += 15;
  if (isMaterialLine(product)) confidence += 15;
  if (product.length > 10) confidence += 10;

  return {
    rawText,
    qty,
    unit,
    product,
    size,
    spec: size ? `${size}` : null,
    lineType,
    confidence: Math.min(confidence, 95),
  };
}

function isNonProductLine(text: string): boolean {
  const lower = text.toLowerCase();
  // Skip email headers
  if (/^(subject|from|to|cc|bcc|date|sent|reply-to|return-path)\s*:/i.test(text)) {
    return true;
  }
  // Skip phone numbers / email signatures (lines that are mostly digits or contain @)
  if (/^[\d\s+()-]{8,}$/.test(text)) return true;
  if (/\b\w+@\w+\.\w+\b/.test(text) && text.length < 60) return true;
  // Skip generic signature roles
  if (/^(buyer|sales|estimator|director|manager|admin|owner|partner)\s*$/i.test(text)) return true;
  // Skip signature names: 2-4 capitalised words, no digits, no plumbing keywords
  if (
    /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\s*$/.test(text) &&
    !/\d/.test(text) &&
    !MATERIAL_KEYWORDS.some((kw) => lower.includes(kw))
  ) {
    return true;
  }
  // Skip company names ending in common suffixes when no qty/material context
  if (
    /(ltd|limited|llp|inc|plc|gmbh|holdings?|park|hall|group|holland|paddington)\s*\.?\s*$/i.test(text) &&
    !/\d/.test(text) &&
    !MATERIAL_KEYWORDS.some((kw) => lower.includes(kw))
  ) {
    return true;
  }
  // Skip greetings, pleasantries, signatures
  const skip = [
    "hi ", "hello", "dear ", "please quote", "can you",
    "thanks", "thank you", "regards", "cheers", "kind regards",
    "let me know", "asap", "urgent", "best price",
    "attached", "see below", "please see", "as discussed",
    "majid", "majiid", "boss", "mate", "morning", "afternoon", "evening",
  ];
  return skip.some((s) => lower.startsWith(s) || lower === s);
}

function isMaterialLine(text: string): boolean {
  const lower = text.toLowerCase();
  return MATERIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * RFQ Extraction Engine v2
 *
 * Parses free-text RFQ blobs (emails, supplier quotes, pasted lists)
 * into structured line candidates.
 *
 * Handles:
 *   - Simple lists:  "6x coupling 40mm solvent"
 *   - No/Nr/Pcs:     "10 No 15mm copper pipe 3m lengths"
 *   - Trailing x:    "Basin Mixer Tap Chrome x 20"
 *   - Dashed items:  "- 8nr Thermostatic Shower Valve"
 *   - Qty: prefix:   "Ball Valve 15mm Compression  Qty: 2  £390"
 *   - Tabular data:  "Pressfit 45 Deg. Bend - 22mm  20  EA  1.34"
 *   - KOOLTHERM etc: "KOOLTHERM Phenolic 21 x 20mm x H/V Section 1000mm  40  M  5.035"
 *   - Price columns: trailing £ or bare decimals as unit prices
 *   - Size dims:     "15mm x 22mm" is a size, NOT qty x size
 */

export interface ExtractedCandidate {
  rawText: string;
  qty: number | null;
  unit: string | null;
  product: string;
  size: string | null;
  spec: string | null;
  unitCost: number | null;
  lineType: string;
  confidence: number;
}

// ─── Material / plumbing keyword list ────────────────────────────────────────

const MATERIAL_KEYWORDS = [
  "pipe", "tube", "fitting", "valve", "tap", "mixer", "waste", "trap",
  "coupling", "elbow", "tee", "reducer", "adapter", "adaptor", "connector",
  "flange", "bracket", "clip", "screw", "bolt", "washer", "seal", "gasket",
  "solder", "flux", "copper", "cooper", "chrome", "brass", "pvc", "mlcp",
  "mdpe", "upvc", "solvent", "cement", "ptfe", "silicone", "radiator",
  "cylinder", "boiler", "thermostat", "shower", "basin", "bath", "toilet",
  "cistern", "press", "pressfit", "compression", "lbv", "motorised",
  "bypass", "lever", "insulation", "band", "ring", "reduced", "hole",
  "bend", "kooltherm", "phenolic", "section", "lagging", "kaiflex",
  "armaflex", "nitrile", "straight", "manifold", "actuator", "strainer",
  "check", "gate", "globe", "butterfly", "ball", "zone", "diverter",
  "nipple", "union", "boss", "cap", "plug", "sleeve", "ferrule", "olive",
  "handle", "spindle", "cartridge", "aerator", "hose", "flexi",
  "tank", "expansion", "vessel", "pump", "circulator",
];

// ─── Unit of measure mappings ────────────────────────────────────────────────

const UNIT_MAP: Record<string, string> = {
  ea: "EA", each: "EA", nr: "EA", no: "EA", nos: "EA", pcs: "EA", pc: "EA",
  off: "EA", unit: "EA", units: "EA",
  m: "M", mtr: "M", metre: "M", meter: "M", metres: "M", meters: "M",
  lm: "M", lin: "M",
  length: "LENGTH", lengths: "LENGTH", lgth: "LENGTH",
  pack: "PACK", packs: "PACK", pkt: "PACK", box: "PACK", boxes: "PACK",
  set: "SET", sets: "SET", kit: "SET", kits: "SET", pair: "SET", pairs: "SET",
  lot: "LOT", package: "LOT",
  roll: "EA", rolls: "EA", tin: "EA", tins: "EA", tube: "EA", can: "EA",
  coil: "LENGTH", coils: "LENGTH",
};

/**
 * Normalise a raw unit string into a canonical UOM.
 */
function normaliseUnit(raw: string): string {
  return UNIT_MAP[raw.toLowerCase().replace(/\.$/, "")] || "EA";
}

// ─── Size detection helpers ──────────────────────────────────────────────────

/**
 * Detect whether an "x" in context is a SIZE separator (dimensions) rather
 * than a quantity multiplier.
 *
 * Rules:
 *   - If both sides of "x" have a unit suffix (mm, inch, ", m), it is a size.
 *   - e.g. "15mm x 22mm", "21 x 20mm", "1/2 x 3/4 inch"
 *   - "H/V" after x is NOT a number so that pattern won't match as qty.
 */
function isSizeCrossing(before: string, after: string): boolean {
  const unitSuffix = /(?:mm|cm|m|inch|"|dn)\s*$/i;
  const unitPrefix = /^\s*\d+(?:[./]\d+)?\s*(?:mm|cm|m|inch|"|dn)?/i;
  // If what follows x is a measurement, it is a size
  if (unitSuffix.test(before.trim()) && unitPrefix.test(after.trim())) return true;
  // "21 x 20mm" — bare number before x, measurement after
  if (/\d\s*$/.test(before.trim()) && /^\s*\d+(?:\.\d+)?\s*mm/i.test(after.trim())) return true;
  // "20mm x H/V" — measurement before, non-numeric after → size context
  if (unitSuffix.test(before.trim()) && /^\s*[A-Za-z]/.test(after.trim())) return true;
  return false;
}

/**
 * Extract all size/dimension tokens from text. Returns them joined.
 * Covers: "15mm", "22.5mm", "1 inch", '1/2"', "DN15", "21 x 20mm",
 *         "1000mm", "(3 Metre Length)"
 */
function extractSizes(text: string): string | null {
  const sizes: string[] = [];

  // Dimension expressions: "21 x 20mm x H/V Section 1000mm"
  // Grab "NNmm" and "NN x NNmm" patterns
  const dimPattern = /\b(\d+(?:[./]\d+)?\s*(?:mm|cm|inch|"|m\b))/gi;
  let m: RegExpExecArray | null;
  while ((m = dimPattern.exec(text)) !== null) {
    sizes.push(m[1].replace(/\s+/g, ""));
  }

  // DN pattern
  const dn = text.match(/\b(DN\d+)\b/i);
  if (dn) sizes.push(dn[1]);

  // Fractional inch: 1/2", 3/4 inch
  const frac = text.match(/\b(\d+\/\d+)\s*(?:inch|")/i);
  if (frac) sizes.push(frac[1] + '"');

  if (sizes.length === 0) return null;
  // Deduplicate
  return Array.from(new Set(sizes)).join(" x ");
}

// ─── Price extraction ────────────────────────────────────────────────────────

interface PriceExtraction {
  value: number;
  matchedText: string;
}

/**
 * Extract a price (unit cost) from the text. Returns the value and the
 * matched text so the caller can remove it from the description.
 */
function extractPrice(text: string): PriceExtraction | null {
  // Explicit currency symbol: £123.45 or $123.45
  const currencyMatch = text.match(/[£$]\s*(\d{1,7}(?:[.,]\d{1,4})?)/);
  if (currencyMatch) {
    return {
      value: parseFloat(currencyMatch[1].replace(",", "")),
      matchedText: currencyMatch[0],
    };
  }
  // "GBP 123.45" or "EUR 123.45"
  const namedCurrency = text.match(/\b(?:GBP|EUR|USD)\s+(\d{1,7}(?:\.\d{1,4})?)/i);
  if (namedCurrency) {
    return {
      value: parseFloat(namedCurrency[1]),
      matchedText: namedCurrency[0],
    };
  }
  return null;
}

// ─── Tabular line detection ──────────────────────────────────────────────────

/**
 * Attempt to parse a line as tabular data where columns are separated by
 * 2+ spaces or tabs. Format detected:
 *
 *   Description   Qty   Unit   UnitPrice   [Total]
 *   or
 *   Description   Qty   UnitPrice
 *
 * Returns parsed fields or null if not tabular.
 */
interface TabularResult {
  description: string;
  qty: number | null;
  unit: string | null;
  unitCost: number | null;
}

function tryParseTabular(rawLine: string): TabularResult | null {
  // Split on 2+ whitespace (spaces or tabs)
  const columns = rawLine.split(/\t|  +/).map((c) => c.trim()).filter(Boolean);

  if (columns.length < 2) return null;

  // We need at least 2 columns and the last column(s) should be numeric
  // Try to identify: last cols are numbers/unit, first col(s) are description

  // Check if last 2-4 columns are numeric or unit strings
  const numericCols: Array<{ value: string; index: number; isNumeric: boolean; isUnit: boolean }> = [];
  for (let i = columns.length - 1; i >= 1; i--) {
    const col = columns[i];
    const isNum = /^\d+(?:[.,]\d+)?$/.test(col);
    const isUnit = /^[A-Za-z]{1,6}$/.test(col) && !!UNIT_MAP[col.toLowerCase().replace(/\.$/, "")];
    if (isNum || isUnit) {
      numericCols.unshift({ value: col, index: i, isNumeric: isNum, isUnit });
    } else {
      break; // stop when we hit a non-numeric/non-unit column
    }
  }

  if (numericCols.length < 1) return null;

  // Description is everything before the numeric columns
  const descEnd = numericCols[0].index;
  const description = columns.slice(0, descEnd).join(" ");
  if (description.length < 2) return null;

  let qty: number | null = null;
  let unit: string | null = null;
  let unitCost: number | null = null;

  if (numericCols.length === 1) {
    // Single trailing number = qty
    qty = parseFloat(numericCols[0].value.replace(",", ""));
  } else if (numericCols.length === 2) {
    if (numericCols[0].isUnit) {
      // Unit + Number: e.g. "EA  1.34" — that is unit + price? Unusual.
      // More likely: Number + Unit — but unit came second
      // Actually: if first is unit and second is numeric, assume qty is missing, unit + price
      unit = normaliseUnit(numericCols[0].value);
      unitCost = parseFloat(numericCols[1].value.replace(",", ""));
    } else if (numericCols[1].isUnit) {
      // Qty + Unit
      qty = parseFloat(numericCols[0].value.replace(",", ""));
      unit = normaliseUnit(numericCols[1].value);
    } else {
      // Two numbers: Qty + UnitPrice
      qty = parseFloat(numericCols[0].value.replace(",", ""));
      unitCost = parseFloat(numericCols[1].value.replace(",", ""));
    }
  } else if (numericCols.length === 3) {
    // Three trailing: Qty + Unit + UnitPrice  OR  Qty + UnitPrice + Total
    if (numericCols[1].isUnit) {
      // Qty + Unit + UnitPrice
      qty = parseFloat(numericCols[0].value.replace(",", ""));
      unit = normaliseUnit(numericCols[1].value);
      unitCost = parseFloat(numericCols[2].value.replace(",", ""));
    } else {
      // Qty + UnitPrice + Total — ignore total
      qty = parseFloat(numericCols[0].value.replace(",", ""));
      unitCost = parseFloat(numericCols[1].value.replace(",", ""));
    }
  } else if (numericCols.length >= 4) {
    // Four+ trailing: Qty + Unit + UnitPrice + Total (+ extras)
    // Find the unit column
    const unitIdx = numericCols.findIndex((c) => c.isUnit);
    if (unitIdx >= 0) {
      // Qty is before unit, price is after
      if (unitIdx > 0) qty = parseFloat(numericCols[unitIdx - 1].value.replace(",", ""));
      unit = normaliseUnit(numericCols[unitIdx].value);
      if (unitIdx + 1 < numericCols.length) {
        unitCost = parseFloat(numericCols[unitIdx + 1].value.replace(",", ""));
      }
    } else {
      // All numeric: Qty + UnitPrice + Total + ???
      qty = parseFloat(numericCols[0].value.replace(",", ""));
      unitCost = parseFloat(numericCols[1].value.replace(",", ""));
    }
  }

  // Sanity: qty should be reasonable (1..99999)
  if (qty !== null && (qty <= 0 || qty > 99999)) qty = null;
  // UnitCost sanity
  if (unitCost !== null && unitCost <= 0) unitCost = null;

  return { description, qty, unit, unitCost };
}

// ─── Quantity extraction from free text ──────────────────────────────────────

interface QtyExtraction {
  qty: number;
  unit: string | null;
  /** The text with the qty pattern removed */
  remaining: string;
}

/**
 * Extract quantity from free-form text. Order matters — more specific patterns
 * are tried first to avoid false positives.
 *
 * CRITICAL: Patterns that look like sizes ("15mm x 22mm") must NOT be treated
 * as quantities. The "x" in "15mm x 22mm" is a dimension separator.
 */
function extractQty(text: string): QtyExtraction | null {
  // ── "Qty: N" or "Quantity: N" or "qty N" ─────────────────────────────────
  const qtyLabel = text.match(/\b(?:qty|quantity)[\s.:]*(\d+)\b/i);
  if (qtyLabel) {
    return {
      qty: parseInt(qtyLabel[1]),
      unit: null,
      remaining: text.replace(qtyLabel[0], "").trim(),
    };
  }

  // ── Leading "N meters/metres of" ─────────────────────────────────────────
  const metersOf = text.match(/^(\d+)\s*(?:meters?|metres?|m)\s+of\s+/i);
  if (metersOf) {
    return {
      qty: parseInt(metersOf[1]),
      unit: "M",
      remaining: text.replace(metersOf[0], "").trim(),
    };
  }

  // ── Leading "Nx" where x is a multiplier (but NOT "15mm x 22mm") ─────────
  const leadingNx = text.match(/^(\d+)\s*[xX×]\s+/);
  if (leadingNx) {
    const beforeX = text.slice(0, leadingNx[0].length).trim();
    const afterX = text.slice(leadingNx[0].length);
    // It is a size crossing ONLY if the number before x also has a unit suffix.
    // "20 x 15mm" → 20 is a bare number → this IS a qty multiplier.
    // "15mm x 22mm" → 15mm has a unit → this is a size crossing.
    const beforeHasUnit = /\d+\s*(?:mm|cm|inch|"|m)\s*$/i.test(beforeX);
    if (!beforeHasUnit) {
      return {
        qty: parseInt(leadingNx[1]),
        unit: null,
        remaining: text.replace(leadingNx[0], "").trim(),
      };
    }
    // If it IS a size crossing, fall through — don't treat as qty
  }

  // ── Leading "N No/Nr/Pcs/Off" ────────────────────────────────────────────
  const leadingNo = text.match(/^-?\s*(\d+)\s*(?:no|nr|nos|pcs?|off)\b[\s.]*/i);
  if (leadingNo) {
    return {
      qty: parseInt(leadingNo[1]),
      unit: "EA",
      remaining: text.replace(leadingNo[0], "").trim(),
    };
  }

  // ── Trailing "x N" (but NOT "NNmm x NNmm") ──────────────────────────────
  const trailingX = text.match(/\s+[xX×]\s*(\d+)\s*$/);
  if (trailingX) {
    const beforeX = text.slice(0, trailingX.index);
    const afterX = trailingX[1];
    if (!isSizeCrossing(beforeX, afterX)) {
      return {
        qty: parseInt(trailingX[1]),
        unit: null,
        remaining: text.replace(trailingX[0], "").trim(),
      };
    }
  }

  // ── Leading bare number + space (NOT followed by measurement-only context)
  // "10 basin mixer" → qty 10. But "15mm copper" should NOT match.
  // Only match if the number is NOT immediately followed by a unit suffix.
  const leadingBare = text.match(/^(\d+)\s+(?!mm|cm|inch|"|m\b|x\b)/i);
  if (leadingBare) {
    const num = parseInt(leadingBare[1]);
    // Avoid matching numbers that are clearly part of a product name/code
    // e.g. "15 Copper Tube" — 15 is ambiguous. But if > 0 and < 10000, allow it.
    if (num > 0 && num < 10000) {
      return {
        qty: num,
        unit: null,
        remaining: text.slice(leadingBare[0].length).trim(),
      };
    }
  }

  return null;
}

// ─── Unit inference from descriptive text ────────────────────────────────────

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

function inferUnit(text: string): string | null {
  for (const [pattern, unit] of UNIT_HINT_PATTERNS) {
    if (pattern.test(text)) return unit;
  }
  return null;
}

// ─── Non-product line detection ──────────────────────────────────────────────

function isNonProductLine(text: string): boolean {
  const lower = text.toLowerCase();

  // Email headers
  if (/^(subject|from|to|cc|bcc|date|sent|reply-to|return-path)\s*:/i.test(text)) return true;

  // Phone numbers
  if (/^[\d\s+()-]{8,}$/.test(text)) return true;

  // Email addresses on short lines
  if (/\b[\w.+-]+@[\w.-]+\.\w+\b/.test(text) && text.length < 60) return true;

  // Signature roles
  if (/^(buyer|sales|estimator|director|manager|admin|owner|partner)\s*$/i.test(text)) return true;

  // Signature names: 2-4 capitalised words, no digits, no plumbing keywords
  if (
    /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\s*$/.test(text) &&
    !/\d/.test(text) &&
    !MATERIAL_KEYWORDS.some((kw) => lower.includes(kw))
  ) {
    return true;
  }

  // Company names ending in common suffixes when no qty/material context
  if (
    /(ltd|limited|llp|inc|plc|gmbh|holdings?|park|hall|group|holland|paddington)\s*\.?\s*$/i.test(text) &&
    !/\d/.test(text) &&
    !MATERIAL_KEYWORDS.some((kw) => lower.includes(kw))
  ) {
    return true;
  }

  // Table headers (if a line is ONLY column header words)
  if (/^(description|item|product|qty|quantity|unit|uom|price|total|amount|ref|code|line)(\s+(description|item|product|qty|quantity|unit|uom|price|total|amount|ref|code|line))+\s*$/i.test(text)) {
    return true;
  }

  // Greetings, pleasantries, signatures
  const skip = [
    "hi", "hello", "dear ", "please quote", "can you", "could you",
    "thanks", "thank you", "regards", "cheers", "kind regards",
    "let me know", "asap", "urgent", "best price",
    "attached", "see below", "please see", "as discussed",
    "majid", "majiid", "boss", "mate", "morning", "afternoon", "evening",
    "total", "sub total", "subtotal", "vat", "net total", "grand total",
    "delivery", "carriage", "postage", "note:", "notes:",
  ];
  // Match if text starts with skip phrase followed by end-of-string, space, comma, or period
  return skip.some((s) => {
    if (lower === s) return true;
    if (lower.startsWith(s)) {
      const nextChar = lower[s.length];
      // If skip phrase already ends with space, startsWith is enough
      if (s.endsWith(" ")) return true;
      // Otherwise require a word boundary after the match
      return !nextChar || nextChar === " " || nextChar === "," || nextChar === "." || nextChar === "!" || nextChar === ":";
    }
    return false;
  });
}

// ─── Material line classification ────────────────────────────────────────────

function isMaterialLine(text: string): boolean {
  const lower = text.toLowerCase();
  return MATERIAL_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Line splitting ──────────────────────────────────────────────────────────

function splitIntoLines(text: string): string[] {
  // Split on newlines first
  let lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  // If only 1-2 lines, try splitting on commas
  if (lines.length <= 2) {
    const commaSplit = text.split(/,\s*/).map((l) => l.trim()).filter(Boolean);
    if (commaSplit.length > 2) lines = commaSplit;
  }

  // If still 1-2 lines, try splitting on "Nx " pattern boundaries
  if (lines.length <= 2) {
    const qtyBoundary = text.split(/(?=\b\d+\s*[xX×]\s)/);
    const filtered = qtyBoundary.map((l) => l.trim()).filter((l) => l.length > 2);
    if (filtered.length > 2) lines = filtered;
  }

  // If still 1-2 lines, try splitting on numbered patterns "1. ... 2. ..."
  if (lines.length <= 2) {
    const numbered = text.split(/(?:\d+[.)]\s*)/).filter((l) => l.trim().length > 2);
    if (numbered.length > 2) lines = numbered;
  }

  // Handle bullet points within each line.
  // IMPORTANT: Only split on bullets/dashes that look like list markers, NOT
  // mid-description dashes like "Bend - 22mm". A list marker dash is either
  // at the start of the line or preceded by a newline-like boundary.
  const expanded: string[] = [];
  for (const line of lines) {
    // Only split on bullet • (always a list marker)
    const bulletSplit = line.split(/\s*•\s+/).filter((l) => l.trim().length > 2);
    if (bulletSplit.length > 1) {
      expanded.push(...bulletSplit);
    } else {
      expanded.push(line);
    }
  }

  // Explode lines containing multiple item markers
  const finalLines: string[] = [];
  for (const line of expanded) {
    const xMatches = line.match(/\b\d+\s*[xX×]\s+\d/g);
    const mOfMatches = line.match(/\b\d+\s*(?:meters?|metres?|m)\s+of\s+\d/gi);
    const totalMarkers = (xMatches?.length || 0) + (mOfMatches?.length || 0);

    if (totalMarkers >= 2) {
      const fragments = line.split(/(?=\b\d+\s*(?:[xX×]|meters?|metres?|m)\s+(?:of\s+)?\d)/);
      for (const frag of fragments) {
        const t = frag.trim();
        if (t.length > 2) finalLines.push(t);
      }
    } else {
      finalLines.push(line);
    }
  }

  // Strip numbered list prefixes and bullet markers
  return finalLines
    .map((l) => l.replace(/^(\d+)[.)]\s+/, "").replace(/^[•\-*]\s*/, "").trim())
    .filter((l) => l.length > 2);
}

// ─── Main line parser ────────────────────────────────────────────────────────

function parseLine(rawText: string): ExtractedCandidate | null {
  // ── Step 1: Try tabular parse first (columns separated by 2+ spaces/tabs) ──
  const tabular = tryParseTabular(rawText);

  let description: string;
  let qty: number | null = null;
  let unit: string | null = null;
  let unitCost: number | null = null;

  if (tabular && tabular.description.length > 2) {
    description = tabular.description;
    qty = tabular.qty;
    unit = tabular.unit;
    unitCost = tabular.unitCost;

    // Also try to extract price from description if tabular didn't find one
    if (unitCost === null) {
      const priceResult = extractPrice(description);
      if (priceResult) {
        unitCost = priceResult.value;
        description = description.replace(priceResult.matchedText, "").trim();
      }
    }

    // Try to extract qty from description if tabular didn't find one
    if (qty === null) {
      const qtyFromDesc = extractQty(description);
      if (qtyFromDesc) {
        qty = qtyFromDesc.qty;
        if (qtyFromDesc.unit) unit = qtyFromDesc.unit;
        description = qtyFromDesc.remaining;
      }
    }
  } else {
    // ── Step 2: Free-text parse ──────────────────────────────────────────────
    let text = rawText;

    // Extract price first (before qty extraction might eat the numbers)
    const priceResult = extractPrice(text);
    if (priceResult) {
      unitCost = priceResult.value;
      text = text.replace(priceResult.matchedText, "").trim();
      if (!text) text = rawText; // fallback if we ate everything
    }

    // Extract quantity
    const qtyResult = extractQty(text);
    if (qtyResult) {
      qty = qtyResult.qty;
      if (qtyResult.unit) unit = qtyResult.unit;
      text = qtyResult.remaining;
    }

    description = text;
  }

  // ── Step 3: Infer unit from description if not already set ────────────────
  if (!unit) {
    unit = inferUnit(description);
  }
  if (!unit) unit = "EA";

  // ── Step 4: Extract sizes ─────────────────────────────────────────────────
  const size = extractSizes(description);

  // ── Step 5: Clean the product description ─────────────────────────────────
  // Keep the full description intact — do NOT strip sizes from the product name.
  // Users need to see "Pressfit 45 Deg. Bend - 22mm" not just "Pressfit Bend".
  let product = description
    .replace(/^\s*[-•*]\s*/, "")     // leading bullets
    .replace(/\s{2,}/g, " ")         // collapse whitespace
    .trim();

  // Remove trailing unit if it looks like it was a column: "EA" at the very end
  product = product.replace(/\s+(EA|M|LM|PACK|SET|LOT|LENGTH|NR|NO|PCS|UNIT)\s*$/i, "").trim();

  if (product.length < 2) return null;

  // ── Step 6: Classify and score ────────────────────────────────────────────
  const lineType = isMaterialLine(product) ? "MATERIAL" : "SERVICE";

  let confidence = 40;
  if (qty !== null) confidence += 20;
  if (size) confidence += 10;
  if (isMaterialLine(product)) confidence += 15;
  if (product.length > 10) confidence += 5;
  if (unitCost !== null) confidence += 10;
  // Bonus for tabular detection — structured data is more reliable
  if (tabular) confidence += 5;

  return {
    rawText,
    qty,
    unit,
    product,
    size,
    spec: size || null,
    unitCost,
    lineType,
    confidence: Math.min(confidence, 98),
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function extractRfqCandidates(rawText: string): ExtractedCandidate[] {
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

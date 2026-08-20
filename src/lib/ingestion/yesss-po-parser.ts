/**
 * Yesss Electrical PO PDF parser.
 *
 * Template-first — Yesss uses a consistent PDF layout across all their branches
 * (London City, Lewisham, etc). We extract text with pdf-parse and then walk
 * the line-item table by regex.
 *
 * Returns a structured representation the auto-action layer can turn into
 * CustomerPO + CustomerPOLine + TicketLine rows directly.
 *
 * The parser refuses to guess. If a sample doesn't match the template it
 * returns null and the caller falls back to the "create shell only" path.
 */

type ParsedLine = {
  qty: number;
  productCode: string;
  description: string;
  unitPrice: number;
  lineTotal: number;
  unit: string; // "Each" in every Yesss sample so far — mapped to EA at persist time
};

export type ParsedYesssPO = {
  poNo: string;
  poDate: string | null; // ISO YYYY-MM-DD
  branch: string; // e.g. "LONDON CITY", "LEWISHAM"
  issuer: string; // Purchase Raised By name
  yourRef: string | null; // Your Ref field (we passed this when raising the quote)
  quoteRefCandidate: string | null; // Q- number if present anywhere
  totalExVat: number;
  lines: ParsedLine[];
  direction: "INBOUND_SALES_PO" | "OUTBOUND_REFLECTION" | "UNKNOWN";
};

const NUM = /([\d,]+\.\d{2}|\d+\.\d{2}|\d+)/;

function toNum(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/** Extract a UK date from a DD/MM/YYYY string. Returns ISO YYYY-MM-DD. */
function parseUkDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Parse the text output from pdf-parse on a Yesss PO PDF. */
export function parseYesssPoText(text: string): ParsedYesssPO | null {
  // Quick sanity — must be a Yesss PO
  if (!/YESSS/i.test(text) || !/Purchase Order:/i.test(text)) return null;

  const poNoMatch = text.match(/Purchase Order:\s*([0-9A-Z/\-]+)/i);
  if (!poNoMatch) return null;
  const poNo = poNoMatch[1].trim();

  const branchMatch = text.match(/YESSS\s+([A-Z][A-Z ]+?)\n/);
  const branch = branchMatch ? branchMatch[1].trim() : "UNKNOWN";

  const issuerMatch = text.match(/([A-Z][A-Z ]+)\nPurchase Raised By/);
  const issuer = issuerMatch ? issuerMatch[1].trim() : "UNKNOWN";

  const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})\nDate/);
  const poDate = parseUkDate(dateMatch?.[1] ?? null);

  const yourRefMatch = text.match(/Your Ref:\s*([^\n]*)\n/);
  const yourRef = yourRefMatch && yourRefMatch[1].trim() ? yourRefMatch[1].trim() : null;

  const totalMatch = text.match(/£\s*([\d,]+\.\d{2})\s*\n?\s*TOTAL ORDER VALUE/i)
    || text.match(/TOTAL ORDER VALUE:?\s*\(?Ex VAT\)?\s*£?\s*([\d,]+\.\d{2})/i);
  const totalExVat = totalMatch ? toNum(totalMatch[1]) : 0;

  // Quote reference (our Q-number) — could appear in yourRef, subject, anywhere
  const qMatch = text.match(/Q-(\d{10,})/);
  const quoteRefCandidate = qMatch ? `Q-${qMatch[1]}` : null;

  // ─── Line-item table ────────────────────────────────────────────────────
  // Each Yesss line, after pdf-parse serialisation, looks like:
  //   {qty}Each\n
  //   {unitCost}\n
  //   {partNo}{description first-line}\n
  //   [{more description lines}\n]*
  //   {unitCost-again}\n
  //   {lineTotal (with commas)}\n
  //   1\n  ← "Per" column, always 1 in all samples
  //
  // We anchor on {qty}Each, then greedily collect until the next one
  // (or the footer).
  const tableStart = text.search(/QuantityPart No\.Description/i);
  if (tableStart < 0) return null;
  const tableEnd = text.search(/TOTAL ORDER VALUE|WE DO NOT EXPECT TO PAY|Invoicing Details/i);
  const table = text.slice(tableStart, tableEnd > tableStart ? tableEnd : text.length);

  const itemStartRe = /\n(\d+)Each\n/g;
  const indices: Array<{ qty: number; idx: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = itemStartRe.exec(table)) !== null) {
    indices.push({ qty: Number(m[1]), idx: m.index + 1 }); // +1 to strip leading \n
  }
  if (indices.length === 0) return null;

  const lines: ParsedLine[] = [];
  for (let i = 0; i < indices.length; i++) {
    const start = indices[i].idx;
    const end = i + 1 < indices.length ? indices[i + 1].idx : table.length;
    const block = table.slice(start, end);
    const row = parseRow(block, indices[i].qty);
    if (row) lines.push(row);
  }

  if (lines.length === 0) return null;

  // Direction detection — a Yesss PO lists the supplier in its header.
  // INBOUND_SALES_PO means Yesss is raising a PO ON us (we're the supplier).
  // OUTBOUND_REFLECTION would mean a PO we raised is bouncing back
  // (not something we've actually seen, but we check as a safety net).
  const supplierHeader = text.match(/Supplier:[\s\n]*Name:[\s\n]*([^\n]+)/i);
  const supplierName = supplierHeader ? supplierHeader[1].trim() : "";
  const direction: ParsedYesssPO["direction"] = /CROMWELL/i.test(supplierName)
    ? "INBOUND_SALES_PO"
    : supplierName
      ? "OUTBOUND_REFLECTION"
      : "UNKNOWN";

  return { poNo, poDate, branch, issuer, yourRef, quoteRefCandidate, totalExVat, lines, direction };
}

function parseRow(block: string, qty: number): ParsedLine | null {
  // Drop the leading "{qty}Each\n"
  const afterQty = block.replace(/^\d+Each\n/, "");

  const lines = afterQty.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length < 4) return null;

  const unitCost = toNum(lines[0]);
  if (!Number.isFinite(unitCost)) return null;

  // Find the "1" Per column from the end
  let perIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === "1") { perIdx = i; break; }
  }
  if (perIdx < 2) return null;

  // Expected layout: [unitCost, ...descriptionLines, unitCostRepeat, lineTotal, 1]
  //
  // Edge case: pdf-parse occasionally smooshes the unit-cost-repeat and
  // line-total onto one line, e.g. "11.1333.39" instead of two lines.
  // When this happens lines[perIdx-1] contains both numbers, lines[perIdx-2]
  // is the last description line, and the "unitCostRepeat" line is missing.
  let lineTotal: number;
  let descEndExclusive: number;

  const penultimate = lines[perIdx - 1];
  const smooshMatch = penultimate.match(/^([\d,]+\.\d{2})([\d,]+\.\d{2})$/);
  const firstPartMatchesCost = smooshMatch && Math.abs(toNum(smooshMatch[1]) - unitCost) < 0.01;
  if (smooshMatch && firstPartMatchesCost) {
    // Smooshed row — second number is the line total, no separate cost-repeat line
    lineTotal = toNum(smooshMatch[2]);
    descEndExclusive = perIdx - 1; // description runs up to (and not including) the smooshed line
  } else {
    lineTotal = toNum(penultimate);
    descEndExclusive = perIdx - 2; // skip the cost-repeat line
  }
  if (!Number.isFinite(lineTotal)) return null;

  const descLines = lines.slice(1, descEndExclusive);
  if (descLines.length === 0) return null;

  const firstLine = descLines[0];
  const { productCode, firstDescPart } = splitProductCode(firstLine);
  const description = [firstDescPart, ...descLines.slice(1)]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return { qty, productCode, description, unitPrice: unitCost, lineTotal, unit: "Each" };
}

/**
 * Split "A861264NU.Ideal Standard Trevi 40mm..." into
 *   { productCode: "A861264NU.", firstDescPart: "Ideal Standard Trevi 40mm..." }
 *
 * Also handles:
 *   "A4852(AA)Sensorflow 21 Compact Mixer"    → { "A4852(AA)", "Sensorflow 21 Compact Mixer" }
 *   "TRAPMcAlpine Adjustable Inlet Bottle Trap" → { "TRAP", "McAlpine Adjustable Inlet Bottle Trap" }
 *   "152.434.16.1Geberit flush pipe kits"       → { "152.434.16.1", "Geberit flush pipe kits" }
 *   "CARRIAGEcharge"                            → { "CARRIAGE", "charge" }
 *   "FIXING KITRawlplug Sanitary Fixing Kit"    → { "FIXING KIT", "Rawlplug Sanitary Fixing Kit" }
 *
 * Strategy: productCode is the longest prefix that is all-caps / digits / punctuation.
 * We stop when we hit the first lowercase letter.
 */
/**
 * Yesss reuses a handful of generic one-word "codes" (not true SKUs) for
 * non-stocked items like carriage, sundries, generic plumbing parts. When we
 * see one of these at the start of a description line, the code ends where
 * the generic label ends — not at the first lowercase character.
 *
 * Order matters: longer phrases first so "FIXING KIT" matches before "FIXING".
 */
const YESSS_GENERIC_CODES = [
  "FIXING KIT",
  "CARRIAGE CHARGE",
  "CARRIAGE",
  "CARR",
  "SUNDRIES",
  "DELIVERY",
  "TRAP",
  "TAPS",
  "TAP",
];

function splitProductCode(line: string): { productCode: string; firstDescPart: string } {
  // 1. Alphanumeric code ending with "." or ")" followed by a capitalised word
  //    e.g. "A5900AA.Ideal Standard..."  or  "A4852(AA)Sensorflow..."
  const terminated = line.match(/^([A-Z0-9][A-Z0-9.()\/]*[.)])([A-Z][^\n]*)$/);
  if (terminated) return { productCode: terminated[1], firstDescPart: terminated[2] };

  // 2. Dotted-decimal code e.g. "152.434.16.1Geberit..."
  const dotted = line.match(/^(\d+(?:\.\d+)+)([A-Za-z].*)$/);
  if (dotted) return { productCode: dotted[1], firstDescPart: dotted[2] };

  // 3. Known generic code dictionary — deterministic
  for (const code of YESSS_GENERIC_CODES) {
    if (line.startsWith(code) && line.length > code.length) {
      return { productCode: code, firstDescPart: line.slice(code.length) };
    }
  }

  // 4. Fallback for uppercase-prefix + capitalised-description:
  //    "FIXING KITRawlplug..." — capture greedy caps then strip one trailing
  //    letter to recover the brand word. Only applies when a lowercase remainder
  //    exists (which rules out the generic codes above).
  const capsPrefix = line.match(/^([A-Z][A-Z0-9 ]*?)([a-z].*)$/);
  if (capsPrefix) {
    const rawCode = capsPrefix[1].trim();
    const rawDesc = capsPrefix[2];

    // Only peel a trailing letter when doing so leaves a plausible code
    // AND produces a description word of 4+ chars (Rawlplug, McAlpine, etc.).
    // Skip peel when `rawCode` is short enough to be a generic label already
    // (safety net — would have matched step 3 but might have been mistyped).
    const codeMatch = rawCode.match(/^(.+?)([A-Z])$/);
    const peeled = codeMatch ? codeMatch[1].trim() : rawCode;
    const peeledFirstWord = codeMatch ? codeMatch[2] + rawDesc.split(/\s/)[0] : "";
    const looksLikeBrandName = peeledFirstWord.length >= 4 && /^[A-Z][a-z]{3,}/.test(peeledFirstWord);
    if (codeMatch && looksLikeBrandName && peeled.length >= 3) {
      return { productCode: peeled, firstDescPart: codeMatch[2] + rawDesc };
    }
    return { productCode: rawCode, firstDescPart: rawDesc };
  }

  return { productCode: "", firstDescPart: line };
}

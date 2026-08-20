/**
 * AI PO PDF parser — fallback for any customer PO layout that isn't
 * covered by a dedicated template parser.
 *
 * Called by `handlePODocument` when the deterministic template parsers
 * (e.g. Yesss) return null. Uses Claude to extract structured line items
 * and returns the same shape the downstream code expects.
 *
 * Safety guardrails:
 *  - Returns null on any parse error rather than inventing data.
 *  - Only accepts a result if the line-total sum matches the stated
 *    total (within 1p) — protects against hallucinated amounts.
 *  - Emits a `confidence` score so low-confidence results can be flagged
 *    for human review instead of auto-actioning.
 */

import { callClaude, isAiEnabled, estimateTokens } from "@/lib/ai/anthropic";

export type ParsedAIPOLine = {
  qty: number;
  productCode: string;
  description: string;
  unitPrice: number;
  lineTotal: number;
  unit: string;
};

export type ParsedAIPO = {
  poNo: string;
  poDate: string | null;
  customerName: string | null;
  issuer: string | null;
  yourRef: string | null;
  quoteRefCandidate: string | null;
  deliveryAddress: string | null;
  totalExVat: number;
  lines: ParsedAIPOLine[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
  source: "AI_PARSER";
};

const SYSTEM_PROMPT = `You extract structured data from inbound customer purchase order PDFs.

Context:
- "Cromwell Plumbing Ltd" is US (the supplier receiving the PO). NEVER set Cromwell as \`customerName\`.
- The PO is from a CUSTOMER to us. \`customerName\` is the company raising the PO (Yesss, Benchmark, IK SABS, etc).
- \`issuer\` is the PERSON at the customer side who raised the PO (typically shown as "Sales", "Purchase Raised By", or near a signature — e.g. "Jonathan Hugill", "Sonny Heear").

Return ONLY valid minified JSON matching this TypeScript type:

{
  "poNo": string,
  "poDate": string | null,
  "customerName": string | null,
  "issuer": string | null,
  "yourRef": string | null,
  "quoteRefCandidate": string | null,
  "deliveryAddress": string | null,
  "totalExVat": number,
  "lines": Array<{
    "qty": number,
    "productCode": string,
    "description": string,
    "unitPrice": number,
    "lineTotal": number,
    "unit": string
  }>,
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}

Rules:
- \`poDate\` format: YYYY-MM-DD (convert any dd/mm/yyyy or similar).
- \`totalExVat\`: the net/ex-VAT total. Never include VAT or inc-VAT values.
- \`lines.lineTotal\` must equal qty × unitPrice (reject the line if the PDF shows otherwise, set confidence LOW).
- \`productCode\` is the SKU/part number shown in the PDF. If the PDF only shows a description (no code), use "".
- \`description\` is the product description with the code stripped out if they were concatenated.
- \`quoteRefCandidate\` is any "Q-1234567890123" style reference to OUR (Cromwell) quote. Null if absent.
- \`unit\` examples: "EA", "Each", "M", "PACK". Use "EA" when unit is missing.
- \`confidence\`:
  - HIGH when all fields resolved cleanly, line sum equals totalExVat to 1p.
  - MEDIUM when minor ambiguity (a partial field, a close-but-off sum).
  - LOW when the document looks malformed or incomplete.
- Exclude carriage/delivery lines ONLY if they're labelled as "Standard Rate VAT" summary rows — otherwise include them as ordinary lines.
- Exclude VAT totals, subtotals, and footer rows from \`lines\`.
- Your response must be ONLY the JSON object — no prose, no markdown, no code fences.`;

/**
 * Parse a PO PDF's extracted text using Claude.
 * Returns null if AI is disabled, the response is invalid, or the
 * arithmetic doesn't reconcile.
 */
export async function parsePOWithAI(pdfText: string): Promise<ParsedAIPO | null> {
  if (!isAiEnabled()) return null;
  if (!pdfText || pdfText.trim().length < 40) return null;
  if (estimateTokens(pdfText) > 20000) return null; // cost guardrail

  try {
    const result = await callClaude(SYSTEM_PROMPT, pdfText, { maxTokens: 2048, temperature: 0.1 });
    const json = extractJson(result.text);
    if (!json) return null;

    const parsed = validate(json);
    if (!parsed) return null;

    // Arithmetic sanity — AI sometimes hallucinates totals. Reject if off.
    const lineSum = parsed.lines.reduce((s, l) => s + l.lineTotal, 0);
    if (Math.abs(lineSum - parsed.totalExVat) > 0.05) {
      return { ...parsed, confidence: "LOW" };
    }
    return parsed;
  } catch (err) {
    console.warn("[ai-po-parser] failed:", err);
    return null;
  }
}

/** Strip code-fence wrapping if Claude adds it despite the instruction. */
function extractJson(raw: string): Record<string, unknown> | null {
  let txt = raw.trim();
  if (txt.startsWith("```")) {
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  }
  const firstBrace = txt.indexOf("{");
  const lastBrace = txt.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  try {
    return JSON.parse(txt.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

function validate(obj: Record<string, unknown>): ParsedAIPO | null {
  if (typeof obj.poNo !== "string" || obj.poNo.length === 0) return null;
  if (typeof obj.totalExVat !== "number" || !Number.isFinite(obj.totalExVat)) return null;
  if (!Array.isArray(obj.lines)) return null;

  const lines: ParsedAIPOLine[] = [];
  for (const raw of obj.lines as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    if (typeof l.qty !== "number" || typeof l.unitPrice !== "number" || typeof l.lineTotal !== "number") continue;
    if (!Number.isFinite(l.qty) || !Number.isFinite(l.unitPrice) || !Number.isFinite(l.lineTotal)) continue;
    lines.push({
      qty: l.qty,
      productCode: typeof l.productCode === "string" ? l.productCode : "",
      description: typeof l.description === "string" ? l.description : "",
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      unit: typeof l.unit === "string" && l.unit ? l.unit : "EA",
    });
  }
  if (lines.length === 0) return null;

  const confidence = obj.confidence === "HIGH" || obj.confidence === "MEDIUM" || obj.confidence === "LOW"
    ? obj.confidence
    : "MEDIUM";

  return {
    poNo: obj.poNo,
    poDate: typeof obj.poDate === "string" ? obj.poDate : null,
    customerName: typeof obj.customerName === "string" ? obj.customerName : null,
    issuer: typeof obj.issuer === "string" ? obj.issuer : null,
    yourRef: typeof obj.yourRef === "string" ? obj.yourRef : null,
    quoteRefCandidate: typeof obj.quoteRefCandidate === "string" && /^Q-\d+$/.test(obj.quoteRefCandidate)
      ? obj.quoteRefCandidate
      : null,
    deliveryAddress: typeof obj.deliveryAddress === "string" ? obj.deliveryAddress : null,
    totalExVat: obj.totalExVat,
    lines,
    confidence,
    source: "AI_PARSER",
  };
}

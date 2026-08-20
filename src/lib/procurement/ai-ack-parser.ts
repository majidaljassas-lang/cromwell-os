/**
 * AI supplier-acknowledgement parser — fallback when the deterministic
 * template parsers (Hipkin / Hargreaves / Barco / Navigator / generic
 * tabular) can't extract lines from a supplier's order confirmation PDF.
 *
 * Mirrors the guardrails used by `ai-po-parser.ts`:
 *  - returns null on any failure rather than inventing data
 *  - arithmetic sanity check (line sum vs stated net total)
 */

import { callClaude, isAiEnabled, estimateTokens } from "@/lib/ai/anthropic";

export type ParsedAIAckLine = {
  qty: number;
  productCode: string;
  description: string;
  unitPrice: number;
  lineTotal: number;
  unit: string;
};

export type ParsedAIAck = {
  orderRef: string | null;
  supplierName: string | null;
  totalNet: number | null;
  lines: ParsedAIAckLine[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
};

const SYSTEM_PROMPT = `You extract structured data from SUPPLIER order acknowledgements (their sales-order confirmations back to us).

Context:
- The PDF is FROM a supplier TO us. We want every ORDERED line item.
- Descriptions often span multiple lines and may be concatenated with the product code (e.g. "79215Copper Pipe 15mm x 3 Metre Length TX153ZL"). Split the code out into productCode, put the rest in description.
- Ignore delivery, totals, VAT rows, address blocks, terms blurbs.
- Use the ORDERED quantity if both ordered and delivered are shown.
- Unit price must be ex-VAT per unit. lineTotal must equal qty × unitPrice (within 1p).

Return ONLY a minified JSON object:

{
  "orderRef": string | null,
  "supplierName": string | null,
  "totalNet": number | null,
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
- orderRef: the supplier's own SO/Order number for this acknowledgement.
- totalNet: ex-VAT total of the order, or null if not present.
- description: cleaned product description (strip the product code from it if concatenated).
- productCode: SKU/ref shown against the line, "" if absent.
- unit: "EA", "M", "PACK", "LENGTH" — "EA" if missing.
- confidence: HIGH when every line has qty, unitPrice, lineTotal and sums match totalNet. MEDIUM if minor issues. LOW if arithmetic doesn't reconcile.
- Output ONLY the JSON — no prose, no code fences.`;

export async function parseAckWithAI(text: string): Promise<ParsedAIAck | null> {
  if (!isAiEnabled()) return null;
  if (!text || text.trim().length < 40) return null;
  if (estimateTokens(text) > 20000) return null;

  try {
    const result = await callClaude(SYSTEM_PROMPT, text, { maxTokens: 2048, temperature: 0.1 });
    const json = extractJson(result.text);
    if (!json) return null;
    const parsed = validate(json);
    if (!parsed) return null;

    if (parsed.totalNet !== null && parsed.lines.length > 0) {
      const lineSum = parsed.lines.reduce((s, l) => s + l.lineTotal, 0);
      if (Math.abs(lineSum - parsed.totalNet) > 0.05) {
        return { ...parsed, confidence: "LOW" };
      }
    }
    return parsed;
  } catch (err) {
    console.warn("[ai-ack-parser] failed:", err);
    return null;
  }
}

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

function validate(obj: Record<string, unknown>): ParsedAIAck | null {
  if (!Array.isArray(obj.lines)) return null;
  const lines: ParsedAIAckLine[] = [];
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
    orderRef: typeof obj.orderRef === "string" ? obj.orderRef : null,
    supplierName: typeof obj.supplierName === "string" ? obj.supplierName : null,
    totalNet: typeof obj.totalNet === "number" ? obj.totalNet : null,
    lines,
    confidence,
  };
}

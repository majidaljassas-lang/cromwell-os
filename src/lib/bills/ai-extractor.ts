/**
 * AI bill extractor — turn a bill-classified InboxThread into structured data.
 *
 * Output shape is stable — downstream (pipeline.ts) creates SupplierBill +
 * SupplierBillLine rows directly from this. Falls back to the regex-based
 * parseBillText when the API key is missing, so the pipeline still runs
 * end-to-end in dev.
 */

import { callClaude, isAiEnabled } from "@/lib/ai/anthropic";
import { parseBillText } from "@/lib/ingestion/bill-parser";

export interface ExtractedBill {
  supplierName: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  customerRef: string | null;
  siteRef: string | null;
  lines: Array<{
    description: string;
    qty: number;
    unit: string | null;
    unitCost: number;
    vatRate: number | null;
    lineTotal: number;
  }>;
  totalExVat: number | null;
  vatAmount: number | null;
  totalIncVat: number | null;
  source: "ai" | "regex";
  confidence: number;
}

const SYSTEM = `You extract supplier bills from email/WhatsApp thread text for a UK construction-materials supplier.

Return strict JSON matching this schema — no prose, no markdown fences:
{
  "supplierName": string|null,
  "invoiceNo": string|null,
  "invoiceDate": "YYYY-MM-DD"|null,
  "dueDate": "YYYY-MM-DD"|null,
  "customerRef": string|null,
  "siteRef": string|null,
  "lines": [{"description": string, "qty": number, "unit": string|null, "unitCost": number, "vatRate": number|null, "lineTotal": number}],
  "totalExVat": number|null,
  "vatAmount": number|null,
  "totalIncVat": number|null
}

Rules:
- All money values in GBP, exclusive of VAT where possible. lineTotal = qty * unitCost.
- vatRate is a percentage (20, 5, 0), not a fraction.
- unit examples: EA, PACK, BOX, M, KG, L. Preserve the supplier's UOM exactly if given.
- If a field is not in the text, return null — do not invent.
- If there are zero identifiable line items, return "lines": [].
- Infer dueDate from payment terms ("30 days", "net 30", "due on receipt") relative to invoiceDate.
- customerRef: The reference the supplier uses for OUR order — look for "your ref", "your reference", "customer ref", "customer PO", "PO number", "PO no", "PO ref", "order ref", "our ref", "your order number", "your order" on the invoice. This is OUR reference number that appears on THEIR invoice. Return null if genuinely absent.
- siteRef: Site, delivery-address reference, or job reference shown on the invoice — look for "site", "site ref", "delivery address", "deliver to", "ship to", "job ref", "project ref", "job number". Prefer a short ref/name over a full postal address. Return null if absent.`;

export async function extractBillFromText(rawText: string): Promise<ExtractedBill> {
  if (!rawText || rawText.trim().length < 20) {
    return emptyResult("regex", 0);
  }

  if (!isAiEnabled()) {
    return regexFallback(rawText);
  }

  try {
    const { text } = await callClaude(SYSTEM, rawText.slice(0, 40_000), {
      maxTokens: 4096,
      temperature: 0,
    });
    const parsed = parseJsonStrict(text);
    if (!parsed) return regexFallback(rawText);

    const lines = Array.isArray(parsed.lines) ? parsed.lines.map(normaliseLine).filter(nonNull) : [];
    return {
      supplierName:  asString(parsed.supplierName),
      invoiceNo:     asString(parsed.invoiceNo),
      invoiceDate:   asDateString(parsed.invoiceDate),
      dueDate:       asDateString(parsed.dueDate),
      customerRef:   asString(parsed.customerRef),
      siteRef:       asString(parsed.siteRef),
      lines,
      totalExVat:    asNumber(parsed.totalExVat),
      vatAmount:     asNumber(parsed.vatAmount),
      totalIncVat:   asNumber(parsed.totalIncVat),
      source:        "ai",
      confidence:    scoreConfidence(parsed, lines.length),
    };
  } catch {
    return regexFallback(rawText);
  }
}

function regexFallback(text: string): ExtractedBill {
  const p = parseBillText(text);
  const lines = (p.lines || []).map((l) => ({
    description: l.description || "Unknown",
    qty:         Number(l.qty) || 1,
    unit:        null,
    unitCost:    Number(l.unitCost) || 0,
    vatRate:     null,
    lineTotal:   Number(l.lineTotal) || 0,
  }));
  const totalExVat = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    supplierName: p.supplierName ?? null,
    invoiceNo:    p.billNo ?? null,
    invoiceDate:  p.billDate ? new Date(p.billDate).toISOString().slice(0, 10) : null,
    dueDate:      null,
    customerRef:  p.customerRef ?? null,
    siteRef:      p.siteRef ?? null,
    lines,
    totalExVat:   totalExVat || null,
    vatAmount:    null,
    totalIncVat:  p.grandTotal ?? null,
    source:       "regex",
    confidence:   lines.length > 0 ? 40 : 0,
  };
}

function emptyResult(source: "ai" | "regex", confidence: number): ExtractedBill {
  return {
    supplierName: null, invoiceNo: null, invoiceDate: null, dueDate: null,
    customerRef: null, siteRef: null,
    lines: [], totalExVat: null, vatAmount: null, totalIncVat: null,
    source, confidence,
  };
}

function parseJsonStrict(s: string): Record<string, unknown> | null {
  const cleaned = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

function normaliseLine(raw: unknown): ExtractedBill["lines"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const description = asString(r.description);
  if (!description) return null;
  const qty      = asNumber(r.qty) ?? 1;
  const unitCost = asNumber(r.unitCost) ?? 0;
  const lineTotal = asNumber(r.lineTotal) ?? round2(qty * unitCost);
  return {
    description,
    qty,
    unit: asString(r.unit),
    unitCost,
    vatRate: asNumber(r.vatRate),
    lineTotal,
  };
}

function nonNull<T>(v: T | null): v is T { return v !== null; }
function asString(v: unknown): string | null { return typeof v === "string" && v.trim() ? v.trim() : null; }
function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v.replace(/[£,\s]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
}
function asDateString(v: unknown): string | null {
  const s = asString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

function scoreConfidence(p: Record<string, unknown>, lineCount: number): number {
  let s = 40;
  if (p.supplierName) s += 15;
  if (p.invoiceNo)    s += 15;
  if (p.invoiceDate)  s += 10;
  if (lineCount > 0)  s += 15;
  if (p.totalIncVat || p.totalExVat) s += 5;
  return Math.min(100, s);
}

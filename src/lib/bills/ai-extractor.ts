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
- siteRef: Site, delivery-address reference, or job reference shown on the invoice — look for "site", "site ref", "delivery address", "deliver to", "ship to", "job ref", "project ref", "job number". Prefer a short ref/name over a full postal address. Return null if absent.

PDF text extraction often produces vertical/fragmented layouts where a single invoice row is broken across many short lines (column-by-column), or where qty/price/total are concatenated with no separators (e.g. "20.001.0026.19130.94130.94" means qty=1, unitCost=26.19, lineTotal=130.94 with VAT% 20.00 and Line VAT 26.19). Reconstruct line items by reading the WHOLE document, not line-by-line — multi-line descriptions (product code on one line, name on the next, dimensions/options below) belong to ONE line item. If you see a clear product code or description plus a recognisable money amount, emit a line — partial data is better than dropping the row, as long as description and lineTotal are both present.

If the document is clearly NOT a supplier bill (e.g. it is a forwarded email body with no invoice table, a bank statement, an order confirmation, a remittance-only statement, a vehicle rental receipt, or it is one of OUR OWN outgoing invoices addressed FROM "Cromwell Plumbing Ltd" TO a customer), return "lines": [] and null for invoiceNo. Do not invent line items from prose.`;

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
    return sanitise({
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
    });
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
  return sanitise({
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
  });
}

// Reject extracted billNos that are obviously header labels or fragments. The
// bill parser has produced "Date", "Customer", "erence" (tail of "Reference"),
// etc. — anything that lacks a digit AND isn't a clearly distinctive token, or
// matches a known column-header word, is junk and must not become a billNo.
const BILL_NO_BLOCKLIST = new Set([
  "date", "customer", "supplier", "reference", "ref", "invoice", "bill",
  "total", "subtotal", "vat", "gross", "net", "amount", "description",
  "quantity", "qty", "price", "unit", "due", "account", "number", "no",
  "erence", "stomer", "voice", "ference", "umber", "ddress",
]);

function isPlausibleBillNo(s: string): boolean {
  const t = s.trim();
  if (t.length < 4) return false;
  if (BILL_NO_BLOCKLIST.has(t.toLowerCase())) return false;
  // Must contain at least one digit OR be ≥6 chars of mixed alphanumerics.
  // "INV" alone fails; "INV001" passes; "ABC1234" passes.
  const hasDigit = /\d/.test(t);
  if (!hasDigit && t.length < 6) return false;
  // Pure alphabetic words ≥6 chars that look like dictionary words: reject.
  if (!hasDigit && /^[A-Za-z]+$/.test(t)) return false;
  return true;
}

// £1m is a hard ceiling for a single supplier bill in this business. Anything
// above that means the parser confused statement balances / running totals
// for a single bill total. Null it and let the bill go to NEEDS_REVIEW with
// the lines preserved for audit.
const MAX_PLAUSIBLE_BILL_TOTAL = 1_000_000;

function isPlausibleAmount(n: number | null): boolean {
  if (n === null) return true; // null is fine — means "not extracted"
  return n >= 0 && n <= MAX_PLAUSIBLE_BILL_TOTAL;
}

function sanitise(b: ExtractedBill): ExtractedBill {
  let confidence = b.confidence;
  let invoiceNo = b.invoiceNo;
  if (invoiceNo && !isPlausibleBillNo(invoiceNo)) {
    invoiceNo = null;
    confidence = Math.max(0, confidence - 25);
  }

  let totalIncVat = b.totalIncVat;
  let totalExVat  = b.totalExVat;
  if (!isPlausibleAmount(totalIncVat)) { totalIncVat = null; confidence = Math.max(0, confidence - 25); }
  if (!isPlausibleAmount(totalExVat))  { totalExVat  = null; confidence = Math.max(0, confidence - 25); }

  // Drop any individual line whose lineTotal is implausibly large — those are
  // statement-balance rows, not invoice lines.
  const cleanLines = b.lines.filter((l) => isPlausibleAmount(l.lineTotal) && isPlausibleAmount(l.unitCost));
  if (cleanLines.length !== b.lines.length) {
    confidence = Math.max(0, confidence - 15);
  }

  return { ...b, invoiceNo, totalIncVat, totalExVat, lines: cleanLines, confidence };
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

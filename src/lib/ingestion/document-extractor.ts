/**
 * Document extractor — parses structured data from emails, PDFs, and messages.
 *
 * Extracts line items with descriptions, quantities, unit prices, and totals
 * from supplier quotes, bills, credit notes, order acks, and delivery notes.
 *
 * Works on plain text (email bodies, WhatsApp messages) and PDF text.
 * AI-powered when ANTHROPIC_API_KEY is set, regex fallback otherwise.
 */

import { callClaude, isAiEnabled } from "@/lib/ai/anthropic";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExtractedLineItem {
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  productCode?: string;
}

export interface ExtractedDocument {
  documentType: "QUOTE" | "BILL" | "CREDIT_NOTE" | "ORDER_ACK" | "DELIVERY_NOTE" | "UNKNOWN";
  documentRef: string | null;       // invoice number, quote number, PO number
  supplierName: string | null;
  documentDate: string | null;
  subtotal: number | null;
  vatAmount: number | null;
  total: number | null;
  lines: ExtractedLineItem[];
  rawText: string;
}

// ── AI Extraction ───────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are extracting structured data from a business document (quote, invoice, bill, credit note, order acknowledgement, or delivery note) for a UK plumbing/construction materials supplier.

Extract ALL information and return ONLY valid JSON with no markdown fences:
{
  "documentType": "QUOTE" | "BILL" | "CREDIT_NOTE" | "ORDER_ACK" | "DELIVERY_NOTE" | "UNKNOWN",
  "documentRef": "quote/invoice/PO number or null",
  "supplierName": "company name of sender or null",
  "documentDate": "YYYY-MM-DD or null",
  "subtotal": 123.45 or null,
  "vatAmount": 24.69 or null,
  "total": 148.14 or null,
  "lines": [
    {
      "description": "product name and specification exactly as written",
      "qty": 1,
      "unit": "EA",
      "unitPrice": 12.50,
      "lineTotal": 12.50,
      "productCode": "SKU or part number or null"
    }
  ]
}

Rules:
- Extract EVERY line item with its price
- unitPrice is the per-unit price EXCLUDING VAT
- lineTotal = qty × unitPrice
- If prices include VAT, divide by 1.2 to get ex-VAT
- unit: EA (each), M (metres), LENGTH, PACK, BOX, ROLL, SET, LOT
- productCode: any SKU, part number, or catalog reference
- documentType: QUOTE for quotations/proformas, BILL for invoices/bills, CREDIT_NOTE for credits, ORDER_ACK for order confirmations
- If no line items found, return empty lines array
- For delivery notes with no prices, set unitPrice and lineTotal to 0`;

export async function extractDocument(text: string): Promise<ExtractedDocument> {
  const trimmed = text.slice(0, 16000);

  // Try AI extraction first
  if (isAiEnabled()) {
    try {
      const result = await callClaude(EXTRACTION_PROMPT, trimmed, {
        maxTokens: 2048,
        temperature: 0.1,
      });

      let jsonStr = result.text.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();

      const parsed = JSON.parse(jsonStr) as ExtractedDocument;
      parsed.rawText = trimmed;

      // Validate and clean lines
      if (Array.isArray(parsed.lines)) {
        parsed.lines = parsed.lines
          .filter((l) => l.description && typeof l.description === "string")
          .map((l) => ({
            description: l.description.slice(0, 500),
            qty: typeof l.qty === "number" && l.qty > 0 ? l.qty : 1,
            unit: l.unit || "EA",
            unitPrice: typeof l.unitPrice === "number" ? l.unitPrice : 0,
            lineTotal: typeof l.lineTotal === "number" ? l.lineTotal : (l.qty || 1) * (l.unitPrice || 0),
            productCode: l.productCode || undefined,
          }));
      } else {
        parsed.lines = [];
      }

      return parsed;
    } catch (err) {
      console.warn("[document-extractor] AI extraction failed:", err instanceof Error ? err.message : err);
    }
  }

  // Regex fallback
  return extractWithRegex(trimmed);
}

// ── Regex Fallback ──────────────────────────────────────────────────────────

function extractWithRegex(text: string): ExtractedDocument {
  const result: ExtractedDocument = {
    documentType: "UNKNOWN",
    documentRef: null,
    supplierName: null,
    documentDate: null,
    subtotal: null,
    vatAmount: null,
    total: null,
    lines: [],
    rawText: text,
  };

  const lower = text.toLowerCase();

  // Document type detection
  if (/quotation|quote|proforma/i.test(lower)) result.documentType = "QUOTE";
  else if (/invoice|bill|amount due/i.test(lower)) result.documentType = "BILL";
  else if (/credit note|credit memo/i.test(lower)) result.documentType = "CREDIT_NOTE";
  else if (/order ack|order confirm|your order/i.test(lower)) result.documentType = "ORDER_ACK";
  else if (/delivery note|despatch|dispatch/i.test(lower)) result.documentType = "DELIVERY_NOTE";

  // Document reference
  const refMatch = text.match(/(?:quote|quotation|invoice|inv|credit note|order|po|ref)[.\s:#-]*([A-Z0-9/-]{3,20})/i);
  if (refMatch) result.documentRef = refMatch[1].trim();

  // Total
  const totalMatch = text.match(/(?:total|amount due|balance due|net total)[^£$\d]*[£$]([\d,.]+)/i);
  if (totalMatch) result.total = Number(totalMatch[1].replace(/,/g, ""));

  // VAT
  const vatMatch = text.match(/(?:vat|tax)[^£$\d]*[£$]([\d,.]+)/i);
  if (vatMatch) result.vatAmount = Number(vatMatch[1].replace(/,/g, ""));

  // Line items — look for patterns like "Description  Qty  Price  Total"
  // or "10 x Product Name @ £5.00"
  const linePatterns = [
    // qty x description @ price
    /(\d+)\s*(?:x|no\.?|nr)\s+(.+?)\s*[@]\s*[£$]([\d,.]+)/gi,
    // description | qty | price | total (pipe or tab separated)
    /([A-Za-z][\w\s,./-]{5,50})\s+(\d+)\s+[£$]?([\d,.]+)\s+[£$]?([\d,.]+)/g,
  ];

  for (const pattern of linePatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (pattern === linePatterns[0]) {
        const qty = Number(match[1]);
        const desc = match[2].trim();
        const price = Number(match[3].replace(/,/g, ""));
        if (desc.length > 3 && qty > 0) {
          result.lines.push({
            description: desc,
            qty,
            unit: "EA",
            unitPrice: price,
            lineTotal: qty * price,
          });
        }
      } else {
        const desc = match[1].trim();
        const qty = Number(match[2]);
        const price = Number(match[3].replace(/,/g, ""));
        const total = Number(match[4].replace(/,/g, ""));
        if (desc.length > 3 && qty > 0) {
          result.lines.push({
            description: desc,
            qty,
            unit: "EA",
            unitPrice: price,
            lineTotal: total || qty * price,
          });
        }
      }
    }
  }

  return result;
}

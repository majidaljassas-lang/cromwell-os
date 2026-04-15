/**
 * Zoho Books Parser
 *
 * Parses Zoho bill payloads into structured bill lines with VAT normalisation.
 * Zoho is the financial spine — bills are hard cost truth.
 */

import { normaliseVat, type AmountBasis, type VatNormalisedAmount } from "./vat";
import { classifyCostLine } from "./classifier";

export interface ZohoBillPayload {
  bill_id?: string;
  bill_number: string;
  vendor_name: string;
  vendor_id?: string;
  date: string;
  due_date?: string;
  total: number;
  sub_total?: number;
  tax_total?: number;
  currency_code?: string;
  reference_number?: string;
  notes?: string;
  custom_fields?: Array<{ label: string; value: string }>;
  line_items: ZohoBillLinePayload[];
}

export interface ZohoBillLinePayload {
  line_item_id?: string;
  name?: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  tax_amount?: number;
  tax_percentage?: number;
  tax_name?: string;
  item_id?: string;
  product_type?: string;
  account_name?: string;
}

export interface ParsedZohoBill {
  externalId: string;
  billNo: string;
  supplierName: string;
  supplierExternalId?: string;
  billDate: string;
  totalCost: number;
  siteRef: string | null;
  customerRef: string | null;
  sourceAttachmentRef?: string;
  lines: ParsedZohoBillLine[];
  isMixedSite: boolean;
  detectedSites: string[];
}

export interface ParsedZohoBillLine {
  externalLineId?: string;
  description: string;
  normalizedItemName: string;
  productCode?: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
  vat: VatNormalisedAmount;
  costClassification: string;
  classificationConfidence: number;
  sourceSiteTextRaw: string | null;
  sourceCustomerTextRaw: string | null;
}

export function parseZohoBill(payload: ZohoBillPayload): ParsedZohoBill {
  const rawSiteRef = extractSiteRef(payload);
  const customerRef = payload.vendor_name || null;

  // Detect mixed-site references — split on / , & + "and" "mixed"
  const siteRefs = splitSiteReferences(rawSiteRef);
  const isMixedSite = siteRefs.length > 1;

  // If mixed site, each line gets the raw compound text (not a resolved single site)
  // The bill-level siteRef stays as the raw compound for the SourceSiteMatch
  // Per-line site assignment must happen during review, not auto-resolution
  const lines = payload.line_items.map((line) =>
    parseZohoBillLine(line, rawSiteRef, customerRef)
  );

  return {
    externalId: payload.bill_id || payload.bill_number,
    billNo: payload.bill_number,
    supplierName: payload.vendor_name,
    supplierExternalId: payload.vendor_id,
    billDate: payload.date,
    totalCost: payload.sub_total ?? payload.total,
    siteRef: rawSiteRef,
    customerRef,
    lines,
    isMixedSite,
    detectedSites: siteRefs,
  };
}

const MIXED_SITE_SEPARATORS = /\s*[\/&+]\s*|\s+and\s+|\s+mixed\s*/i;

function splitSiteReferences(rawSiteRef: string | null): string[] {
  if (!rawSiteRef) return [];
  const parts = rawSiteRef.split(MIXED_SITE_SEPARATORS).map((s) => s.trim()).filter((s) => s.length > 0);
  // "mixed" at the end is a flag, not a site name — remove it
  return parts.filter((p) => p.toLowerCase() !== "mixed");
}

function parseZohoBillLine(
  line: ZohoBillLinePayload,
  siteRef: string | null,
  customerRef: string | null
): ParsedZohoBillLine {
  // Determine VAT basis — Zoho typically provides ex-VAT rates with separate tax
  const hasTax = line.tax_amount != null && line.tax_amount > 0;
  const basis: AmountBasis = hasTax ? "EX_VAT" : "UNKNOWN";
  const vatRate = line.tax_percentage ?? (hasTax ? 20 : undefined);

  const vat = normaliseVat(line.amount, basis, vatRate);

  // Classify the cost line
  const { classification, confidence } = classifyCostLine(line.description);

  // Extract a manufacturer SKU from the description (Zoho often puts it on its own first line)
  const skuMatch = line.description?.match(/^([A-Z][A-Z0-9./-]{2,})\b/);
  const productCode = line.item_id || skuMatch?.[1] || undefined;

  // Zoho can return amount=0 when sub_total/tax handling is unusual. Always fall back to qty * rate.
  const lineTotal = line.amount && line.amount !== 0 ? line.amount : (line.quantity * line.rate);

  return {
    externalLineId: line.line_item_id,
    description: line.description,
    normalizedItemName: normaliseItemName(line.description),
    productCode,
    qty: line.quantity,
    unitCost: line.rate,
    lineTotal,
    vat,
    costClassification: classification,
    classificationConfidence: confidence,
    sourceSiteTextRaw: siteRef,
    sourceCustomerTextRaw: customerRef,
  };
}

function extractSiteRef(payload: ZohoBillPayload): string | null {
  // Check custom fields for site reference
  if (payload.custom_fields) {
    const siteField = payload.custom_fields.find(
      (f) => f.label.toLowerCase().includes("site") || f.label.toLowerCase().includes("project")
    );
    if (siteField?.value) return siteField.value;
  }

  // Check reference number for site clues
  if (payload.reference_number) return payload.reference_number;

  // Check notes
  if (payload.notes) {
    const siteMatch = payload.notes.match(/(?:site|project|job)[\s:]+([^\n,]+)/i);
    if (siteMatch) return siteMatch[1].trim();
  }

  return null;
}

function normaliseItemName(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

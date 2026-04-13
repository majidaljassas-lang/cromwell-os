/**
 * Ingestion Classifier
 *
 * Classifies parsed messages and bill lines into commercial categories.
 * Rules-based first, AI assistance layered afterward.
 */

// Message classification for WhatsApp/Outlook
export type MessageClassification =
  | "ORDER"
  | "QUOTE_REQUEST"
  | "APPROVAL"
  | "FOLLOW_UP"
  | "DELIVERY_UPDATE"
  | "DISPUTE"
  | "PO_DOCUMENT"
  | "BILL_DOCUMENT"
  | "CREDIT_NOTE"
  | "GENERAL_CHATTER"
  | "SCHEDULE"
  | "RECOVERY_EVIDENCE"
  | "UNKNOWN";

// Cost line classification (maps to CostClassification enum)
export type CostLineClassification =
  | "BILLABLE"
  | "ABSORBED"
  | "REALLOCATABLE"
  | "STOCK"
  | "MOQ_EXCESS"
  | "CREDIT"
  | "WRITE_OFF";

const ORDER_KEYWORDS = [
  "order", "need", "send", "supply", "deliver", "want", "require",
  "can you get", "how much for", "price for", "quote for",
];

const APPROVAL_KEYWORDS = [
  "go ahead", "approved", "confirm", "yes please", "that's fine",
  "proceed", "accepted", "agreed", "ok go", "lets go",
];

const DELIVERY_KEYWORDS = [
  "delivered", "on site", "arrived", "dropped off", "driver",
  "collection", "picked up", "in transit", "eta", "pod",
];

const DISPUTE_KEYWORDS = [
  "wrong", "damaged", "missing", "short", "incorrect", "dispute",
  "not what", "overcharged", "credit", "return",
];

const PO_KEYWORDS = [
  "purchase order", "po number", "po no", "po ref", "po:", "p.o.",
];

const BILL_KEYWORDS = [
  "invoice attached", "please find attached invoice", "invoice number",
  "invoice no", "inv no", "amount due", "payment terms", "net total",
  "total inc vat", "total incl vat", "grand total", "balance due",
  "remittance advice", "statement of account", "tax invoice",
  "vat invoice", "proforma invoice",
];

const ABSORBED_KEYWORDS = [
  "courier", "dhl", "delivery charge", "carriage", "fuel",
  "rush", "express", "same day", "next day delivery",
];

export function classifyMessage(text: string): {
  classification: MessageClassification;
  confidence: number;
  reasons: string[];
} {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  let classification: MessageClassification = "UNKNOWN";
  let confidence = 30;

  // Check in priority order
  if (matchesKeywords(lower, PO_KEYWORDS)) {
    classification = "PO_DOCUMENT";
    confidence = 80;
    reasons.push("Contains PO reference keywords");
  } else if (matchesKeywords(lower, BILL_KEYWORDS)) {
    classification = "BILL_DOCUMENT";
    confidence = 80;
    reasons.push("Contains supplier bill/invoice keywords");
  } else if (matchesKeywords(lower, APPROVAL_KEYWORDS)) {
    classification = "APPROVAL";
    confidence = 75;
    reasons.push("Contains approval language");
  } else if (matchesKeywords(lower, DISPUTE_KEYWORDS)) {
    classification = "DISPUTE";
    confidence = 75;
    reasons.push("Contains dispute/problem language");
  } else if (matchesKeywords(lower, DELIVERY_KEYWORDS)) {
    classification = "DELIVERY_UPDATE";
    confidence = 70;
    reasons.push("Contains delivery/logistics language");
  } else if (matchesKeywords(lower, ORDER_KEYWORDS)) {
    classification = "ORDER";
    confidence = 65;
    reasons.push("Contains order/supply language");
  } else if (lower.length < 20) {
    classification = "GENERAL_CHATTER";
    confidence = 50;
    reasons.push("Very short message");
  }

  // Boost confidence if monetary values present
  if (/£[\d,.]+|\d+\.\d{2}/.test(text)) {
    confidence = Math.min(confidence + 10, 95);
    reasons.push("Contains monetary value");
  }

  return { classification, confidence, reasons };
}

export function classifyCostLine(description: string): {
  classification: CostLineClassification;
  confidence: number;
  reasons: string[];
} {
  const lower = description.toLowerCase();
  const reasons: string[] = [];

  if (matchesKeywords(lower, ABSORBED_KEYWORDS)) {
    return {
      classification: "ABSORBED",
      confidence: 75,
      reasons: ["Description matches absorbed cost patterns (delivery/courier)"],
    };
  }

  if (/credit|refund|reversal/.test(lower)) {
    return {
      classification: "CREDIT",
      confidence: 80,
      reasons: ["Description indicates credit/refund"],
    };
  }

  // Default to BILLABLE — the most common classification
  return {
    classification: "BILLABLE",
    confidence: 60,
    reasons: ["Default classification — requires review"],
  };
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

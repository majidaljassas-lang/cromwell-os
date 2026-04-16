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

const ORDER_ACK_KEYWORDS = [
  "order acknowledgement", "order confirmation", "order confirmed",
  "thank you for your order", "we have received your order",
  "your order has been received", "order accepted",
  "acknowledgement", "order ref",
];

const ORDER_KEYWORDS = [
  "please order", "need to order", "send us", "supply us", "want to order",
  "require", "can you get", "how much for", "price for", "quote for",
];

const APPROVAL_KEYWORDS = [
  "go ahead", "approved", "confirm", "yes please", "that's fine",
  "proceed", "accepted", "agreed", "ok go", "lets go",
];

const DELIVERY_KEYWORDS = [
  "delivered", "on site", "arrived", "dropped off", "driver",
  "collection", "picked up", "in transit", "eta", "pod",
  "dispatch", "dispatched", "dispatching", "shipped", "shipping",
  "consignment", "tracking", "out for delivery", "despatch",
  "dispatch confirmation", "your order has been dispatched",
  "your order has shipped", "order dispatched",
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

export function classifyMessage(
  text: string,
  options: { fallback?: MessageClassification } = {}
): {
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
    confidence = 80;
    reasons.push("Contains delivery/dispatch keywords");
  } else if (matchesKeywords(lower, ORDER_ACK_KEYWORDS)) {
    classification = "ORDER";
    confidence = 70;
    reasons.push("Order acknowledgement from supplier");
  } else if (matchesKeywords(lower, ORDER_KEYWORDS)) {
    classification = "ORDER";
    confidence = 65;
    reasons.push("Contains order/supply language");
  } else if (lower.length < 20) {
    classification = "GENERAL_CHATTER";
    confidence = 50;
    reasons.push("Very short message");
  }

  // PDF fallback: if body classification came back weak but the text also
  // contains attachment markers ("--- filename.pdf ---"), scan every
  // attachment section (from the first marker onward) for bill/PO keywords.
  // Many supplier bill emails have a bland body and the real signal lives
  // only inside the PDF text.
  if (classification === "UNKNOWN" || classification === "GENERAL_CHATTER") {
    const firstMarker = text.indexOf("--- ");
    if (firstMarker !== -1) {
      const pdfSection = text.slice(firstMarker).toLowerCase();
      if (matchesKeywords(pdfSection, BILL_KEYWORDS)) {
        classification = "BILL_DOCUMENT";
        confidence = 75;
        reasons.push("PDF attachment text contains bill keywords");
      } else if (matchesKeywords(pdfSection, PO_KEYWORDS)) {
        classification = "PO_DOCUMENT";
        confidence = 75;
        reasons.push("PDF attachment text contains PO keywords");
      }
    }
  }

  // Caller-supplied fallback (e.g. WhatsApp text that matched no keyword list
  // should land in GENERAL_CHATTER rather than UNKNOWN, so it doesn't sit
  // forever in NEEDS_TRIAGE).
  if (classification === "UNKNOWN" && options.fallback) {
    classification = options.fallback;
    reasons.push(`No keyword match — fell back to ${options.fallback}`);
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

/**
 * Ingestion Classifier
 *
 * Classifies parsed messages and bill lines into commercial categories.
 * Rules-based first, AI assistance layered afterward.
 */

import { subjectLooksLikeBill, subjectLooksLikeStatement } from "@/lib/intake/email-body-detector";

// Message classification for WhatsApp/Outlook
export type MessageClassification =
  | "CUSTOMER_ORDER"
  | "SUPPLIER_ORDER_ACK"
  | "ORDER"
  | "QUOTE_REQUEST"
  | "APPROVAL"
  | "FOLLOW_UP"
  | "DELIVERY_UPDATE"
  | "DISPUTE"
  | "PO_DOCUMENT"
  | "BILL_DOCUMENT"
  | "STATEMENT"
  | "CREDIT_NOTE"
  | "SUPPLIER_QUOTE"
  | "RETURN_REQUEST"
  | "GENERAL_CHATTER"
  | "SCHEDULE"
  | "RECOVERY_EVIDENCE"
  | "UNKNOWN";

/**
 * Action / reaction frame (Universal Ingestion, Phase A).
 *   ACTION   — opens a new loop (new ticket, new task, new draft)
 *   REACTION — closes an existing loop (resolves a task, posts AP, marks delivered)
 *   NOISE    — no trigger; archive
 *   REVIEW   — needs human eyes before we can decide intent
 */
export type Intent = "ACTION" | "REACTION" | "NOISE" | "REVIEW";

const INTENT_BY_CLASSIFICATION: Record<MessageClassification, Intent> = {
  CUSTOMER_ORDER:     "ACTION",
  QUOTE_REQUEST:      "ACTION",
  PO_DOCUMENT:        "ACTION",
  RETURN_REQUEST:     "ACTION",
  SUPPLIER_ORDER_ACK: "REACTION",
  ORDER:              "REACTION",
  APPROVAL:           "REACTION",
  FOLLOW_UP:          "REACTION",
  DELIVERY_UPDATE:    "REACTION",
  DISPUTE:            "REACTION",
  BILL_DOCUMENT:      "REACTION",
  STATEMENT:          "REACTION",
  CREDIT_NOTE:        "REACTION",
  SUPPLIER_QUOTE:     "REACTION",
  SCHEDULE:           "REACTION",
  GENERAL_CHATTER:    "NOISE",
  RECOVERY_EVIDENCE:  "NOISE",
  UNKNOWN:            "REVIEW",
};

export function intentForClassification(c: MessageClassification): Intent {
  return INTENT_BY_CLASSIFICATION[c];
}

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
  "remittance advice", "tax invoice",
  "vat invoice", "proforma invoice",
];

const STATEMENT_KEYWORDS = [
  "statement of account", "account statement", "statement period",
  "outstanding invoices", "aged debt", "balance carried forward",
  "balance brought forward", "opening balance", "closing balance",
];

const SUPPLIER_QUOTE_KEYWORDS = [
  "quotation", "quote ref", "quote no", "quote number",
  "valid until", "quote valid", "quotation valid",
  "lead time", "delivery in", "stock on hand",
  "pro-forma quotation", "proforma quotation",
];

const RETURN_REQUEST_KEYWORDS = [
  "return request", "would like to return", "want to return",
  "need to return", "returning these", "raise a return",
  "wrong item delivered", "wrong size delivered",
  "please collect", "arrange collection", "collect from site",
  "send a collection", "items to go back",
];

const ABSORBED_KEYWORDS = [
  "courier", "dhl", "delivery charge", "carriage", "fuel",
  "rush", "express", "same day", "next day delivery",
];

export interface ClassifyResult {
  classification: MessageClassification;
  confidence: number;
  reasons: string[];
  intent: Intent;
}

export function classifyMessage(
  text: string,
  options: { fallback?: MessageClassification; subject?: string | null } = {}
): ClassifyResult {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  let classification: MessageClassification = "UNKNOWN";
  let confidence = 30;

  // Subject is the strongest signal — Majid's Outlook accounts-payable rule
  // matches on subject alone. Statement first (more specific), then bill.
  if (options.subject && subjectLooksLikeStatement(options.subject)) {
    return {
      classification: "STATEMENT",
      confidence: 90,
      reasons: ["Subject matches statement-of-account pattern"],
      intent: intentForClassification("STATEMENT"),
    };
  }
  if (options.subject && subjectLooksLikeBill(options.subject)) {
    return {
      classification: "BILL_DOCUMENT",
      confidence: 90,
      reasons: ["Subject matches accounts-payable bill rule"],
      intent: intentForClassification("BILL_DOCUMENT"),
    };
  }

  // Check in priority order. Statement is checked before bill because
  // "statement of account" emails carry many bill-flavoured words but are
  // a different doctype with a different downstream handler.
  if (matchesKeywords(lower, PO_KEYWORDS)) {
    classification = "PO_DOCUMENT";
    confidence = 80;
    reasons.push("Contains PO reference keywords");
  } else if (matchesKeywords(lower, STATEMENT_KEYWORDS)) {
    classification = "STATEMENT";
    confidence = 80;
    reasons.push("Contains statement-of-account keywords");
  } else if (matchesKeywords(lower, SUPPLIER_QUOTE_KEYWORDS)) {
    classification = "SUPPLIER_QUOTE";
    confidence = 75;
    reasons.push("Contains supplier quotation keywords");
  } else if (matchesKeywords(lower, RETURN_REQUEST_KEYWORDS)) {
    classification = "RETURN_REQUEST";
    confidence = 80;
    reasons.push("Contains return-request keywords");
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
    classification = "SUPPLIER_ORDER_ACK";
    confidence = 80;
    reasons.push("Order acknowledgement from supplier");
  } else if (matchesKeywords(lower, ORDER_KEYWORDS)) {
    classification = "CUSTOMER_ORDER";
    confidence = 65;
    reasons.push("Customer order / request to supply");
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

  return { classification, confidence, reasons, intent: intentForClassification(classification) };
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

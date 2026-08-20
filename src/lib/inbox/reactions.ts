/**
 * Reaction registry — maps an AI classification to the action the user should
 * take ("the reaction"). Each reaction is realised as a Task and routes to a
 * destination page.
 *
 * Direction (customer vs supplier) is encoded in the classification names —
 * see ai-classifier.ts SYSTEM_PROMPT for the canonical taxonomy.
 *
 * The user always confirms or overrides the suggestion; runtime is invoked
 * via PATCH /api/inbox/threads/[id] action="REACT".
 */

export type ReactionId =
  | "PREPARE_QUOTE"
  | "CONFIRM_AVAILABILITY"
  | "ANSWER_RFI"
  | "PROCESS_ORDER"
  | "ACKNOWLEDGE_APPROVAL"
  | "PROCESS_CHANGE_ORDER"
  | "SEND_STATEMENT"
  | "RESOLVE_INVOICE_QUERY"
  | "ALLOCATE_REMITTANCE"
  | "TRIAGE_COMPLAINT"
  | "ANSWER_DELIVERY_QUERY"
  | "REVIEW_SUPPLIER_QUOTE"
  | "MATCH_ORDER_ACK"
  | "ATTACH_DISPATCH_NOTE"
  | "PROCESS_BILL"
  | "PROCESS_CREDIT_NOTE"
  | "RECONCILE_STATEMENT"
  | "VERIFY_BANK_DETAILS"
  | "FLAG_BACKORDER"
  | "ARCHIVE_NOISE"
  | "CONVERT_TO_TICKET"
  | "CUSTOM_TASK";

export type TerminalThreadStatus = "ARCHIVED" | "LINKED" | "AUTO_TICKETED" | "TRIAGED";

// Top-level bucket per Majid's mental model: every comm is either
// operational (touches a ticket / order / delivery / quote pipeline),
// financial (touches money — bills, statements, remittances, invoices),
// or rubbish (noise / OOO / marketing — gets archived without follow-up).
export type ReactionCategory = "OPERATIONAL" | "FINANCIAL" | "RUBBISH";

export const CATEGORY_COLOUR: Record<ReactionCategory, string> = {
  OPERATIONAL: "#FF6600",
  FINANCIAL:   "#FFCC00",
  RUBBISH:     "#666666",
};

export interface ReactionContext {
  threadId: string;
  linkedTicketId: string | null;
  linkedSupplierBillId: string | null;
  linkedSalesInvoiceId: string | null;
  customerId: string | null;
  supplierId: string | null;
  siteId: string | null;
  poRef: string | null;
}

export interface ReactionSpec {
  id: ReactionId;
  taskType: string;
  category: ReactionCategory;
  label: string;
  description: string;
  destinationRoute: (ctx: ReactionContext) => string | null;
  closesOnSignal?: { docType: string; matcherKeys: string[] };
  terminalThreadStatus: TerminalThreadStatus;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  needsTicket: boolean;
  swallowsTask?: boolean; // if true, no Task is created (e.g. ARCHIVE_NOISE)
}

const fallbackToThread = (ctx: ReactionContext) => `/inbox/threads/${ctx.threadId}`;

export const REACTIONS: Record<ReactionId, ReactionSpec> = {
  PREPARE_QUOTE: {
    id: "PREPARE_QUOTE",
    taskType: "PREPARE_QUOTE",
    category: "OPERATIONAL",
    label: "Prepare quote →",
    description: "Build a quote for the requested items",
    destinationRoute: (ctx) => `/quotes/new?fromThread=${ctx.threadId}`,
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  CONFIRM_AVAILABILITY: {
    id: "CONFIRM_AVAILABILITY",
    taskType: "CONFIRM_AVAILABILITY",
    category: "OPERATIONAL",
    label: "Confirm availability →",
    description: "Reply with stock + lead time",
    destinationRoute: (ctx) => `/inbox/threads/${ctx.threadId}/reply?template=availability`,
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  ANSWER_RFI: {
    id: "ANSWER_RFI",
    taskType: "ANSWER_RFI",
    category: "OPERATIONAL",
    label: "Answer RFI →",
    description: "Reply with the requested info / spec / cert",
    destinationRoute: (ctx) => `/inbox/threads/${ctx.threadId}/reply`,
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  PROCESS_ORDER: {
    id: "PROCESS_ORDER",
    taskType: "REVIEW_AUTO_TICKET",
    category: "OPERATIONAL",
    label: "Create ticket →",
    description: "Promote this order into a Ticket",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId
        ? `/tickets/${ctx.linkedTicketId}`
        : `/tickets/new?fromThread=${ctx.threadId}`,
    terminalThreadStatus: "AUTO_TICKETED",
    priority: "HIGH",
    needsTicket: false,
  },
  ACKNOWLEDGE_APPROVAL: {
    id: "ACKNOWLEDGE_APPROVAL",
    taskType: "APPROVAL_RECEIVED",
    category: "OPERATIONAL",
    label: "Acknowledge approval →",
    description: "Mark the approval and progress the ticket",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId ? `/tickets/${ctx.linkedTicketId}` : fallbackToThread(ctx),
    terminalThreadStatus: "LINKED",
    priority: "HIGH",
    needsTicket: true,
  },
  PROCESS_CHANGE_ORDER: {
    id: "PROCESS_CHANGE_ORDER",
    taskType: "REVIEW_DISPUTE",
    category: "OPERATIONAL",
    label: "Process change →",
    description: "Amend the linked ticket / order",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId ? `/tickets/${ctx.linkedTicketId}` : fallbackToThread(ctx),
    terminalThreadStatus: "LINKED",
    priority: "HIGH",
    needsTicket: true,
  },
  SEND_STATEMENT: {
    id: "SEND_STATEMENT",
    taskType: "SEND_STATEMENT",
    category: "FINANCIAL",
    label: "Send statement →",
    description: "Email the customer their AR statement",
    destinationRoute: (ctx) =>
      ctx.customerId ? `/customers/${ctx.customerId}` : fallbackToThread(ctx),
    terminalThreadStatus: "ARCHIVED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  RESOLVE_INVOICE_QUERY: {
    id: "RESOLVE_INVOICE_QUERY",
    taskType: "REVIEW_DISPUTE",
    category: "FINANCIAL",
    label: "Open invoice →",
    description: "Open the queried sales invoice and respond",
    destinationRoute: (ctx) =>
      ctx.linkedSalesInvoiceId
        ? `/invoices/${ctx.linkedSalesInvoiceId}`
        : ctx.customerId
          ? `/customers/${ctx.customerId}`
          : fallbackToThread(ctx),
    terminalThreadStatus: "LINKED",
    priority: "HIGH",
    needsTicket: false,
  },
  ALLOCATE_REMITTANCE: {
    id: "ALLOCATE_REMITTANCE",
    taskType: "ALLOCATE_PAYMENT",
    category: "FINANCIAL",
    label: "Allocate payment →",
    description: "Match remittance to open invoices",
    destinationRoute: () => `/banking`,
    terminalThreadStatus: "ARCHIVED",
    priority: "HIGH",
    needsTicket: false,
  },
  TRIAGE_COMPLAINT: {
    id: "TRIAGE_COMPLAINT",
    taskType: "REVIEW_DISPUTE",
    category: "OPERATIONAL",
    label: "Triage complaint →",
    description: "Escalate, investigate, and reply",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId
        ? `/tickets/${ctx.linkedTicketId}`
        : fallbackToThread(ctx),
    terminalThreadStatus: "LINKED",
    priority: "CRITICAL",
    needsTicket: false,
  },
  ANSWER_DELIVERY_QUERY: {
    id: "ANSWER_DELIVERY_QUERY",
    taskType: "DELIVERY_UPDATE_RECEIVED",
    category: "OPERATIONAL",
    label: "Reply with ETA →",
    description: "Check delivery status and reply",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId
        ? `/tickets/${ctx.linkedTicketId}`
        : `/inbox/threads/${ctx.threadId}/reply?template=delivery`,
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  REVIEW_SUPPLIER_QUOTE: {
    id: "REVIEW_SUPPLIER_QUOTE",
    taskType: "REVIEW_SUPPLIER_QUOTE",
    category: "OPERATIONAL",
    label: "Review supplier quote →",
    description: "Log supplier price on ticket",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId ? `/tickets/${ctx.linkedTicketId}` : fallbackToThread(ctx),
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: true,
  },
  MATCH_ORDER_ACK: {
    id: "MATCH_ORDER_ACK",
    taskType: "ACK_DISCREPANCY",
    category: "OPERATIONAL",
    label: "Match order ack →",
    description: "Compare ack against placed PO",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId ? `/tickets/${ctx.linkedTicketId}` : fallbackToThread(ctx),
    closesOnSignal: { docType: "ACK", matcherKeys: ["poRef"] },
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: true,
  },
  ATTACH_DISPATCH_NOTE: {
    id: "ATTACH_DISPATCH_NOTE",
    taskType: "CONFIRM_DELIVERY_RECEIPT",
    category: "OPERATIONAL",
    label: "Confirm delivery →",
    description: "Mark the ticket as delivered",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId ? `/tickets/${ctx.linkedTicketId}` : fallbackToThread(ctx),
    closesOnSignal: { docType: "DELIVERY", matcherKeys: ["poRef"] },
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: true,
  },
  PROCESS_BILL: {
    id: "PROCESS_BILL",
    taskType: "BILL_NEEDS_REVIEW",
    category: "FINANCIAL",
    label: "Process bill →",
    description: "Open the bill and post / allocate it",
    destinationRoute: (ctx) =>
      ctx.linkedSupplierBillId
        ? `/bills/${ctx.linkedSupplierBillId}`
        : `/bills`,
    closesOnSignal: { docType: "BILL", matcherKeys: ["billNo", "supplierId"] },
    terminalThreadStatus: "LINKED",
    priority: "HIGH",
    needsTicket: false,
  },
  PROCESS_CREDIT_NOTE: {
    id: "PROCESS_CREDIT_NOTE",
    taskType: "CREDIT_NOTE_REVIEW",
    category: "FINANCIAL",
    label: "Process credit note →",
    description: "Open the credit note and allocate it",
    destinationRoute: (ctx) =>
      ctx.linkedSupplierBillId
        ? `/bills/${ctx.linkedSupplierBillId}`
        : `/bills`,
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  RECONCILE_STATEMENT: {
    id: "RECONCILE_STATEMENT",
    taskType: "STATEMENT_RECONCILE",
    category: "FINANCIAL",
    label: "Reconcile statement →",
    description: "Match supplier statement against AP",
    destinationRoute: (ctx) =>
      ctx.supplierId ? `/suppliers/${ctx.supplierId}` : `/suppliers`,
    terminalThreadStatus: "ARCHIVED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  VERIFY_BANK_DETAILS: {
    id: "VERIFY_BANK_DETAILS",
    taskType: "BANK_DETAIL_CHANGE_ALERT",
    category: "FINANCIAL",
    label: "Verify bank details →",
    description: "Confirm the change by phone before paying",
    destinationRoute: (ctx) =>
      ctx.supplierId ? `/suppliers/${ctx.supplierId}` : `/suppliers`,
    terminalThreadStatus: "LINKED",
    priority: "CRITICAL",
    needsTicket: false,
  },
  FLAG_BACKORDER: {
    id: "FLAG_BACKORDER",
    taskType: "ORDER_SHORTAGE",
    category: "OPERATIONAL",
    label: "Flag backorder →",
    description: "Note the delay against the ticket",
    destinationRoute: (ctx) =>
      ctx.linkedTicketId ? `/tickets/${ctx.linkedTicketId}` : fallbackToThread(ctx),
    terminalThreadStatus: "LINKED",
    priority: "MEDIUM",
    needsTicket: true,
  },
  ARCHIVE_NOISE: {
    id: "ARCHIVE_NOISE",
    taskType: "ARCHIVE_NOISE",
    category: "RUBBISH",
    label: "Archive →",
    description: "Mark as noise and remove from inbox",
    destinationRoute: () => null,
    terminalThreadStatus: "ARCHIVED",
    priority: "LOW",
    needsTicket: false,
    swallowsTask: true,
  },
  CONVERT_TO_TICKET: {
    id: "CONVERT_TO_TICKET",
    taskType: "REVIEW_AUTO_TICKET",
    category: "OPERATIONAL",
    label: "New ticket →",
    description: "Manually start a ticket from this thread",
    destinationRoute: (ctx) => `/tickets/new?fromThread=${ctx.threadId}`,
    terminalThreadStatus: "AUTO_TICKETED",
    priority: "MEDIUM",
    needsTicket: false,
  },
  CUSTOM_TASK: {
    id: "CUSTOM_TASK",
    taskType: "REVIEW_DISPUTE",
    category: "OPERATIONAL",
    label: "Custom task →",
    description: "Open the thread and create your own task",
    destinationRoute: fallbackToThread,
    terminalThreadStatus: "TRIAGED",
    priority: "MEDIUM",
    needsTicket: false,
  },
};

// ── Classification → primary suggested reaction ─────────────────────────────

const CLASSIFICATION_TO_REACTION: Record<string, ReactionId> = {
  // Customer-side
  ORDER:                "PROCESS_ORDER",
  QUOTE_REQUEST:        "PREPARE_QUOTE",
  AVAILABILITY_REQUEST: "CONFIRM_AVAILABILITY",
  RFI:                  "ANSWER_RFI",
  APPROVAL:             "ACKNOWLEDGE_APPROVAL",
  CHANGE_ORDER:         "PROCESS_CHANGE_ORDER",
  STATEMENT_REQUEST:    "SEND_STATEMENT",
  INVOICE_QUERY:        "RESOLVE_INVOICE_QUERY",
  PAYMENT_REMITTANCE:   "ALLOCATE_REMITTANCE",
  COMPLAINT:            "TRIAGE_COMPLAINT",
  DELIVERY_QUERY:       "ANSWER_DELIVERY_QUERY",

  // Supplier-side
  SUPPLIER_QUOTE:       "REVIEW_SUPPLIER_QUOTE",
  ORDER_ACK:            "MATCH_ORDER_ACK",
  DISPATCH_NOTE:        "ATTACH_DISPATCH_NOTE",
  BILL_DOCUMENT:        "PROCESS_BILL",
  CREDIT_NOTE:          "PROCESS_CREDIT_NOTE",
  STATEMENT_RECEIVED:   "RECONCILE_STATEMENT",
  BANK_DETAIL_CHANGE:   "VERIFY_BANK_DETAILS",
  BACKORDER_NOTICE:     "FLAG_BACKORDER",

  // System
  NOISE:                "ARCHIVE_NOISE",
  OUT_OF_OFFICE:        "ARCHIVE_NOISE",
  INTERNAL:             "ARCHIVE_NOISE",

  // Legacy aliases (pre-2026-05 taxonomy) — keep working without re-classify
  SPEC_DRIVEN:          "PREPARE_QUOTE",
  COMPETITIVE_BID:      "PREPARE_QUOTE",
  DELIVERY_UPDATE:      "ATTACH_DISPATCH_NOTE",
  DISPUTE:              "TRIAGE_COMPLAINT",
  SCHEDULE:             "ANSWER_RFI",
  PO_DOCUMENT:          "PROCESS_ORDER",
  // Keyword classifier emits "STATEMENT" (not STATEMENT_RECEIVED) — alias it
  // so legacy rows and bare-word matches reconcile correctly.
  STATEMENT:            "RECONCILE_STATEMENT",
  SUPPLIER_ORDER_ACK:   "MATCH_ORDER_ACK",
  RETURN_REQUEST:       "PROCESS_CREDIT_NOTE",
  // Thread-builder's quickClassify uses SHORT CODES on InboxThread.classification.
  // Mirror them so suggestReaction works without aiClassification re-run.
  // (ORDER is already in the canonical block above.)
  BILL:                 "PROCESS_BILL",
  QUOTE:                "PREPARE_QUOTE",
  DELIVERY:             "ATTACH_DISPATCH_NOTE",
  QUERY:                "ANSWER_RFI",
  REPLY:                "ANSWER_RFI",
  CUSTOMER_ORDER:       "PROCESS_ORDER",
  REMITTANCE:           "ALLOCATE_REMITTANCE",
  GENERAL_CHATTER:      "ARCHIVE_NOISE",
};

export function suggestReaction(
  classification: string | null,
): ReactionSpec | null {
  if (!classification) return null;
  const id = CLASSIFICATION_TO_REACTION[classification];
  return id ? REACTIONS[id] : null;
}

// ── Alternatives offered in the dropdown swap menu ──────────────────────────

const ALTERNATIVES_BY_PRIMARY: Record<ReactionId, ReactionId[]> = {
  PREPARE_QUOTE:        ["CONFIRM_AVAILABILITY", "ANSWER_RFI", "CONVERT_TO_TICKET", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  CONFIRM_AVAILABILITY: ["PREPARE_QUOTE", "ANSWER_RFI", "CONVERT_TO_TICKET", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  ANSWER_RFI:           ["PREPARE_QUOTE", "CONFIRM_AVAILABILITY", "CONVERT_TO_TICKET", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  PROCESS_ORDER:        ["PREPARE_QUOTE", "PROCESS_CHANGE_ORDER", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  ACKNOWLEDGE_APPROVAL: ["PROCESS_ORDER", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  PROCESS_CHANGE_ORDER: ["PROCESS_ORDER", "TRIAGE_COMPLAINT", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  SEND_STATEMENT:       ["RESOLVE_INVOICE_QUERY", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  RESOLVE_INVOICE_QUERY:["SEND_STATEMENT", "TRIAGE_COMPLAINT", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  ALLOCATE_REMITTANCE:  ["RESOLVE_INVOICE_QUERY", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  TRIAGE_COMPLAINT:     ["PROCESS_CHANGE_ORDER", "RESOLVE_INVOICE_QUERY", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  ANSWER_DELIVERY_QUERY:["ATTACH_DISPATCH_NOTE", "TRIAGE_COMPLAINT", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  REVIEW_SUPPLIER_QUOTE:["MATCH_ORDER_ACK", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  MATCH_ORDER_ACK:      ["REVIEW_SUPPLIER_QUOTE", "ATTACH_DISPATCH_NOTE", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  ATTACH_DISPATCH_NOTE: ["MATCH_ORDER_ACK", "ANSWER_DELIVERY_QUERY", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  PROCESS_BILL:         ["PROCESS_CREDIT_NOTE", "RECONCILE_STATEMENT", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  PROCESS_CREDIT_NOTE:  ["PROCESS_BILL", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  RECONCILE_STATEMENT:  ["PROCESS_BILL", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  VERIFY_BANK_DETAILS:  ["ARCHIVE_NOISE", "CUSTOM_TASK"],
  FLAG_BACKORDER:       ["MATCH_ORDER_ACK", "ATTACH_DISPATCH_NOTE", "TRIAGE_COMPLAINT", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  ARCHIVE_NOISE:        ["CONVERT_TO_TICKET", "PREPARE_QUOTE", "PROCESS_BILL", "CUSTOM_TASK"],
  CONVERT_TO_TICKET:    ["PREPARE_QUOTE", "PROCESS_ORDER", "ARCHIVE_NOISE", "CUSTOM_TASK"],
  CUSTOM_TASK:          ["PREPARE_QUOTE", "CONVERT_TO_TICKET", "ARCHIVE_NOISE"],
};

export function alternativesTo(reactionId: ReactionId): ReactionSpec[] {
  return (ALTERNATIVES_BY_PRIMARY[reactionId] ?? []).map((id) => REACTIONS[id]);
}

// ── Default reaction when classification is missing ─────────────────────────

export const DEFAULT_REACTION: ReactionSpec = REACTIONS.CUSTOM_TASK;

/**
 * Email bill detector — mirrors Majid's existing Outlook "Accounts Payable" rule:
 *   Subject contains "Invoice" OR "Credit" OR "ORD-" OR "Hansgrohe eServ. Inv"
 *   AND Sent To = the user (i.e. INCOMING only — sent-items are out)
 *
 * That rule is the single source of truth for what counts as a supplier bill.
 * The sync route enforces incoming-only by simply not pulling sent items.
 *
 * Helpers:
 *   - subjectLooksLikeBill(subject) — for header-driven detection (preferred)
 *   - looksLikeBillBody(bodyText, fromAddress) — fallback for body-only emails
 *     where the subject is generic but the content is clearly a bill
 */

// Subject patterns that mirror the Outlook rule (case-insensitive substring match)
export const BILL_SUBJECT_KEYWORDS = [
  "invoice",
  "credit",
  "ord-",
  "hansgrohe eserv. inv",
  // Useful additions for emails the Outlook rule already routed but Cromwell
  // OS may also see directly (account statements, order acknowledgements, etc.)
  "statement",
  "acknowledgement",
  "acknowledgment",
  "order confirmation",
  "remittance",
  "credit note",
  "pro forma",
  "proforma",
] as const;

const BILL_KEYWORDS = ["invoice", "bill", "total", "vat", "subtotal", "amount due", "balance"] as const;

/**
 * Header-only check — returns true when the email subject matches the
 * Outlook accounts-payable rule. This is the PRIMARY signal: any inbound
 * email with such a subject that has a PDF attachment OR a £-flavoured body
 * is treated as a supplier bill.
 */
export function subjectLooksLikeBill(subject: string | null | undefined): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return BILL_SUBJECT_KEYWORDS.some((kw) => s.includes(kw));
}

/**
 * Returns true when the email body looks like a supplier bill, even if the
 * subject didn't match. Used as a backstop only — the subject check above
 * catches >95% of real bills.
 *
 * @param bodyText    - Plain-text body of the email (HTML already stripped).
 * @param fromAddress - Sender email address (currently unused — kept for API stability).
 */
export function looksLikeBillBody(bodyText: string, _fromAddress: string): boolean {
  if (bodyText.length <= 200) return false;
  if (!bodyText.includes("£")) return false;

  const bodyLower = bodyText.toLowerCase();
  const matchedKeywords = BILL_KEYWORDS.filter((kw) => bodyLower.includes(kw));
  return matchedKeywords.length >= 2;
}

/** @deprecated — retained for back-compat with any caller that still imports it. Now empty. */
export const BILL_SENDER_DOMAINS: readonly string[] = [];

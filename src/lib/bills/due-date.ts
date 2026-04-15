/**
 * Due-date inference from bill text when the AI extractor didn't fill it in.
 * Scans for UK-style payment terms ("net 30", "30 days", "due on receipt")
 * and falls back to invoiceDate + 30 days.
 */

const DAY = 86_400_000;

export function inferDueDate(invoiceDate: Date, rawText: string, _supplierId?: string | null): Date {
  const text = (rawText || "").toLowerCase();

  if (/due\s+on\s+receipt|payable\s+on\s+receipt|cash\s+on\s+delivery/i.test(rawText)) {
    return invoiceDate;
  }

  const netMatch = text.match(/(?:net|payment terms?|terms)[^\d]{0,15}(\d{1,3})\s*(?:days?|d\b)/);
  if (netMatch) {
    const days = Math.max(0, Math.min(180, Number(netMatch[1])));
    return new Date(invoiceDate.getTime() + days * DAY);
  }

  const plainDays = text.match(/\b(\d{1,3})\s*days?\s*(?:net|from\s+invoice|end\s+of\s+month|eom)?/);
  if (plainDays) {
    const days = Math.max(0, Math.min(180, Number(plainDays[1])));
    return new Date(invoiceDate.getTime() + days * DAY);
  }

  return new Date(invoiceDate.getTime() + 30 * DAY);
}

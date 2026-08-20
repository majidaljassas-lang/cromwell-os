/**
 * Paper P&L — materials bought and given to a customer without charging.
 *
 * Two numbers, and they must never be confused:
 *   actualCostTotal  — real money out. Already in the accounts via the SupplierBill.
 *   paperSaleTotal   — the agreed rate this WOULD have been billed at. Never invoiced,
 *                      never collected, never posted to the GL.
 *
 * paperMarginTotal is what we gave up by not charging. It is NOT revenue and must not
 * be summed into anything that reports actual turnover.
 *
 * Owns writes to PaperLedgerEntry. See src/app/api/finance/paper-pnl/route.ts
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type PaperTotals = {
  actualCostTotal: number;
  paperSaleTotal: number;
  paperMarginTotal: number;
};

/**
 * Single source of truth for the paper-vs-real arithmetic. The route stores these;
 * the report sums the stored values rather than recomputing, matching how
 * TicketLine.actualMarginTotal is handled.
 */
export function computePaperTotals(input: {
  qty: number;
  actualCostUnit: number;
  agreedRateUnit: number;
}): PaperTotals {
  const actualCostTotal = r2(input.qty * input.actualCostUnit);
  const paperSaleTotal = r2(input.qty * input.agreedRateUnit);
  return {
    actualCostTotal,
    paperSaleTotal,
    paperMarginTotal: r2(paperSaleTotal - actualCostTotal),
  };
}

/**
 * VAT Normalisation Engine
 *
 * All commercial calculations use EX VAT internally.
 * Original source basis is always preserved.
 */

export type VatStatus = "CONFIRMED" | "ASSUMED" | "UNKNOWN";
export type AmountBasis = "EX_VAT" | "INC_VAT" | "UNKNOWN";

export interface VatNormalisedAmount {
  sourceAmountBasis: AmountBasis;
  rawAmount: number;
  amountExVat: number | null;
  vatAmount: number | null;
  amountIncVat: number | null;
  vatRate: number;
  vatStatus: VatStatus;
}

const UK_STANDARD_VAT = 20;

export function normaliseVat(
  rawAmount: number,
  basis: AmountBasis,
  vatRate?: number,
  vatStatus?: VatStatus
): VatNormalisedAmount {
  const rate = vatRate ?? UK_STANDARD_VAT;
  const status = vatStatus ?? (vatRate != null ? "CONFIRMED" : "ASSUMED");

  if (basis === "EX_VAT") {
    const vatAmount = rawAmount * (rate / 100);
    return {
      sourceAmountBasis: basis,
      rawAmount,
      amountExVat: round2(rawAmount),
      vatAmount: round2(vatAmount),
      amountIncVat: round2(rawAmount + vatAmount),
      vatRate: rate,
      vatStatus: status,
    };
  }

  if (basis === "INC_VAT") {
    const amountExVat = rawAmount / (1 + rate / 100);
    const vatAmount = rawAmount - amountExVat;
    return {
      sourceAmountBasis: basis,
      rawAmount,
      amountExVat: round2(amountExVat),
      vatAmount: round2(vatAmount),
      amountIncVat: round2(rawAmount),
      vatRate: rate,
      vatStatus: status,
    };
  }

  // UNKNOWN basis:
  // - rawAmount preserved (source truth)
  // - amountExVat = NULL (not 0, not rawAmount)
  // - vatAmount = NULL
  // - amountIncVat = NULL
  // - line will be BLOCKED_VAT_UNKNOWN in commercialiser
  // - excluded from deal sheet, bundles, invoices, margin calcs, readiness totals
  return {
    sourceAmountBasis: "UNKNOWN",
    rawAmount,
    amountExVat: null,
    vatAmount: null,
    amountIncVat: null,
    vatRate: rate,
    vatStatus: "UNKNOWN",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

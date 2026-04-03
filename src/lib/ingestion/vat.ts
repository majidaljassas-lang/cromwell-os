/**
 * VAT Normalisation Engine
 *
 * All commercial calculations use EX VAT internally.
 * Original source basis is always preserved.
 *
 * For UNKNOWN basis:
 * - vatRate = NULL (no assumed rate leaks into downstream)
 * - amountExVat / vatAmount / amountIncVat = NULL
 * - rawAmount preserved as source truth
 * - assumedVatRate carries the system default separately for UI display only
 */

export type VatStatus = "CONFIRMED" | "ASSUMED" | "UNKNOWN";
export type AmountBasis = "EX_VAT" | "INC_VAT" | "UNKNOWN";

export interface VatNormalisedAmount {
  sourceAmountBasis: AmountBasis;
  rawAmount: number;
  amountExVat: number | null;
  vatAmount: number | null;
  amountIncVat: number | null;
  vatRate: number | null;
  assumedVatRate: number | null;
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
      assumedVatRate: null,
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
      assumedVatRate: null,
      vatStatus: status,
    };
  }

  // UNKNOWN basis:
  // - rawAmount preserved (source truth, never overwritten)
  // - vatRate = NULL (not 20 — no real rate known)
  // - assumedVatRate = UK default (for UI display / future resolution only)
  // - all calculated fields NULL — nothing usable downstream
  // - commercialiser sets commercialStatus = BLOCKED_VAT_UNKNOWN
  return {
    sourceAmountBasis: "UNKNOWN",
    rawAmount,
    amountExVat: null,
    vatAmount: null,
    amountIncVat: null,
    vatRate: null,
    assumedVatRate: UK_STANDARD_VAT,
    vatStatus: "UNKNOWN",
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

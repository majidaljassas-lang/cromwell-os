/**
 * UOM Normalisation — Strict
 *
 * Every line must carry: raw_qty, raw_uom, normalised_qty, canonical_uom.
 * If conversion is unknown → STATUS = REVIEW_REQUIRED, FLAG = UOM_MISMATCH.
 * DO NOT reconcile quantities without matching UOM.
 */

import { prisma } from "@/lib/prisma";

export interface UomResult {
  normalisedQty: number | null;
  canonicalUom: string | null;
  uomResolved: boolean;
  mismatchReason?: string;
}

/**
 * Normalise a raw qty + uom to the canonical UOM for a given product.
 * Uses UomConversion table first, then falls back to built-in conversions.
 */
export async function normaliseUom(
  canonicalProductId: string,
  rawQty: number,
  rawUom: string,
  canonicalUom: string
): Promise<UomResult> {
  const normRawUom = rawUom.toUpperCase().trim();
  const normCanonUom = canonicalUom.toUpperCase().trim();

  // Already in canonical unit
  if (normRawUom === normCanonUom || isEquivalentUom(normRawUom, normCanonUom)) {
    return { normalisedQty: rawQty, canonicalUom: normCanonUom, uomResolved: true };
  }

  // Check DB for conversion
  const conversion = await prisma.uomConversion.findUnique({
    where: {
      canonicalProductId_fromUom_toUom: {
        canonicalProductId,
        fromUom: normRawUom,
        toUom: normCanonUom,
      },
    },
  });

  if (conversion) {
    const factor = Number(conversion.factor);
    return {
      normalisedQty: rawQty * factor,
      canonicalUom: normCanonUom,
      uomResolved: true,
    };
  }

  // No conversion found — UOM_MISMATCH
  return {
    normalisedQty: null,
    canonicalUom: normCanonUom,
    uomResolved: false,
    mismatchReason: `No conversion from ${normRawUom} to ${normCanonUom} for product ${canonicalProductId}`,
  };
}

/**
 * Synchronous normalisation using known built-in equivalences only.
 * For use when DB access is not available.
 */
export function normaliseUomSync(
  rawQty: number,
  rawUom: string,
  canonicalUom: string
): UomResult {
  const normRawUom = rawUom.toUpperCase().trim();
  const normCanonUom = canonicalUom.toUpperCase().trim();

  if (normRawUom === normCanonUom || isEquivalentUom(normRawUom, normCanonUom)) {
    return { normalisedQty: rawQty, canonicalUom: normCanonUom, uomResolved: true };
  }

  return {
    normalisedQty: null,
    canonicalUom: normCanonUom,
    uomResolved: false,
    mismatchReason: `No built-in conversion from ${normRawUom} to ${normCanonUom}`,
  };
}

/** Known equivalent UOM aliases */
function isEquivalentUom(a: string, b: string): boolean {
  const EQUIVALENCES: Record<string, string[]> = {
    EA: ["NO", "NR", "NOS", "PCS", "PC", "EACH", "UNIT", "UNITS", "PIECE", "PIECES"],
    M: ["MTR", "METRE", "METRES", "METER", "METERS", "LM"],
    M2: ["SQM", "SQMTR"],
    LENGTH: ["LEN", "LENGTHS"],
    PACK: ["PK", "PKT"],
    COIL: ["ROLL"],
  };

  for (const [canonical, aliases] of Object.entries(EQUIVALENCES)) {
    const group = [canonical, ...aliases];
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

/** Parse raw UOM text into a normalised form */
export function parseRawUom(raw: string): string {
  const s = raw.toUpperCase().trim();
  const ALIASES: Record<string, string> = {
    NO: "EA", NR: "EA", NOS: "EA", PCS: "EA", PC: "EA",
    EACH: "EA", UNIT: "EA", UNITS: "EA", PIECE: "EA", PIECES: "EA",
    MTR: "M", METRE: "M", METRES: "M", METER: "M", METERS: "M", LM: "M",
    SQM: "M2", SQMTR: "M2",
    LEN: "LENGTH", LENGTHS: "LENGTH",
    PK: "PACK", PKT: "PACK",
    ROLL: "COIL",
  };
  return ALIASES[s] || s;
}

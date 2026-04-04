/**
 * Product Normalization + Unit Conversion
 *
 * Maps messy WhatsApp/invoice text to clean product types.
 * Extendable via ProductNormalization table.
 */

// ─── Built-in normalization rules ───────────────────────────────────────────

const NORMALIZATION_RULES: Array<{ patterns: RegExp[]; normalized: string; category: string }> = [
  // Plasterboard
  { patterns: [/plasterboard/i, /\bboard\b.*(?:siniat|gtec|standard)/i, /standard\s*board/i, /12\.?5\s*mm.*board/i], normalized: "PLASTERBOARD_12.5MM", category: "DRYLINING" },
  { patterns: [/15\s*mm.*board/i, /fire.*board/i, /fireline/i], normalized: "PLASTERBOARD_15MM", category: "DRYLINING" },
  { patterns: [/moisture.*board/i, /aqua.*board/i], normalized: "PLASTERBOARD_MOISTURE", category: "DRYLINING" },

  // Studs
  { patterns: [/c[-\s]?stud/i, /metal\s*stud/i, /CS70/i, /C-Stud/i], normalized: "C_STUD", category: "DRYLINING" },

  // Track
  { patterns: [/u[-\s]?track.*deep/i, /deep\s*flange/i, /track\s*deep/i], normalized: "TRACK_DEEP_FLANGE", category: "DRYLINING" },
  { patterns: [/u[-\s]?track.*standard/i, /track\s*standard/i, /72\s*mm\s*u\s*track(?!.*deep)/i], normalized: "TRACK_STANDARD", category: "DRYLINING" },
  { patterns: [/u[-\s]?track/i, /\btrack\b/i], normalized: "TRACK", category: "DRYLINING" },

  // Flat strap
  { patterns: [/flat\s*strap/i, /siniat\s*flat/i], normalized: "FLAT_STRAP", category: "DRYLINING" },

  // Insulation
  { patterns: [/mineral\s*wool/i, /acoustic\s*roll/i, /insulation/i, /25\s*mm\s*mineral/i], normalized: "INSULATION_25MM", category: "INSULATION" },
  { patterns: [/50\s*mm\s*insul/i], normalized: "INSULATION_50MM", category: "INSULATION" },
  { patterns: [/100\s*mm\s*insul/i], normalized: "INSULATION_100MM", category: "INSULATION" },

  // Screws & fixings
  { patterns: [/drywall\s*screw/i, /board\s*screw/i], normalized: "DRYWALL_SCREWS", category: "FIXINGS" },
  { patterns: [/wood\s*screw/i], normalized: "WOOD_SCREWS", category: "FIXINGS" },

  // Plaster & finishing
  { patterns: [/easy\s*filler/i, /filler/i, /easifill/i], normalized: "FILLER", category: "FINISHING" },
  { patterns: [/plaster.*galvanised/i, /galvanised.*bead/i], normalized: "PLASTER_BEAD", category: "FINISHING" },
  { patterns: [/jointing\s*tape/i, /scrim/i], normalized: "JOINTING_TAPE", category: "FINISHING" },

  // Adhesives
  { patterns: [/stick\s*like\s*sh/i, /grab\s*adhesive/i, /sticks\s*like/i], normalized: "GRAB_ADHESIVE", category: "ADHESIVES" },
  { patterns: [/tile.*adhesive/i], normalized: "TILE_ADHESIVE", category: "ADHESIVES" },

  // Silicone
  { patterns: [/silicone\s*white/i], normalized: "SILICONE_WHITE", category: "SEALANTS" },
  { patterns: [/silicone\s*clear/i], normalized: "SILICONE_CLEAR", category: "SEALANTS" },

  // Copper pipe
  { patterns: [/15\s*mm\s*copp?er/i, /copp?er.*15/i], normalized: "COPPER_PIPE_15MM", category: "PLUMBING" },
  { patterns: [/22\s*mm\s*copp?er/i, /copp?er.*22/i], normalized: "COPPER_PIPE_22MM", category: "PLUMBING" },
  { patterns: [/28\s*mm\s*copp?er/i, /copp?er.*28/i], normalized: "COPPER_PIPE_28MM", category: "PLUMBING" },

  // Basin / taps
  { patterns: [/basin\s*mixer/i, /basin\s*tap/i], normalized: "BASIN_MIXER_TAP", category: "PLUMBING" },
  { patterns: [/shower\s*valve/i, /thermostatic.*valve/i], normalized: "THERMOSTATIC_SHOWER_VALVE", category: "PLUMBING" },
  { patterns: [/iso.*valve/i, /isolation.*valve/i, /gate.*valve/i], normalized: "ISOLATION_VALVE", category: "PLUMBING" },

  // MLCP
  { patterns: [/mlcp.*pipe/i, /multilayer.*pipe/i, /16\s*mm\s*mlcp/i], normalized: "MLCP_PIPE", category: "PLUMBING" },
  { patterns: [/mlcp.*press/i, /press\s*fitting/i], normalized: "MLCP_PRESS_FITTING", category: "PLUMBING" },
];

export function normalizeProduct(rawText: string): { normalized: string; category: string; confidence: number } {
  const lower = rawText.toLowerCase();

  for (const rule of NORMALIZATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(lower)) {
        return { normalized: rule.normalized, category: rule.category, confidence: 85 };
      }
    }
  }

  return { normalized: "UNKNOWN", category: "UNKNOWN", confidence: 0 };
}

// ─── Unit Conversion ────────────────────────────────────────────────────────

const CONVERSIONS: Record<string, { factor: number; baseUnit: string }> = {
  TRACK: { factor: 3.0, baseUnit: "M" },
  TRACK_DEEP_FLANGE: { factor: 3.0, baseUnit: "M" },
  TRACK_STANDARD: { factor: 3.0, baseUnit: "M" },
  FLAT_STRAP: { factor: 2.4, baseUnit: "M" },
};

export function convertToBase(normalized: string, qty: number, unit: string): { qtyBase: number; baseUnit: string } {
  // If already in metres, keep as is
  if (unit === "M" || unit === "m") {
    return { qtyBase: qty, baseUnit: "M" };
  }

  const conv = CONVERSIONS[normalized];
  if (conv) {
    // qty is in lengths/pieces, convert to metres
    return { qtyBase: qty * conv.factor, baseUnit: conv.baseUnit };
  }

  // No conversion — base = original
  return { qtyBase: qty, baseUnit: unit };
}

// ─── Extract qty + unit from raw text ───────────────────────────────────────

export function extractQtyUnit(text: string): { qty: number; unit: string } | null {
  // "430 No of" / "260 No of" / "1000 m2 of"
  const noMatch = text.match(/(\d[\d,.]*)\s*(?:No|no|nr|nos|pcs?)\s+(?:of\s+)?/);
  if (noMatch) return { qty: parseFloat(noMatch[1].replace(/,/g, "")), unit: "EA" };

  // "130m of" / "260m of"
  const mMatch = text.match(/(\d[\d,.]*)\s*m\s+(?:of\s+)?/);
  if (mMatch) return { qty: parseFloat(mMatch[1].replace(/,/g, "")), unit: "M" };

  // "1000 m2 of"
  const m2Match = text.match(/(\d[\d,.]*)\s*m2\s+(?:of\s+)?/);
  if (m2Match) return { qty: parseFloat(m2Match[1].replace(/,/g, "")), unit: "M2" };

  // "10x" / "6x"
  const xMatch = text.match(/(\d+)\s*[xX×]/);
  if (xMatch) return { qty: parseInt(xMatch[1]), unit: "EA" };

  // Leading number: "430 plasterboards"
  const leadMatch = text.match(/^[•\-\s]*(\d[\d,.]*)\s+/);
  if (leadMatch) return { qty: parseFloat(leadMatch[1].replace(/,/g, "")), unit: "EA" };

  return null;
}

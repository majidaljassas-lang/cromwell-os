/**
 * Small hand-curated product-family taxonomy for the ack matcher.
 *
 * Used as a soft boost in line-matching: if the demand line and the
 * supply line belong to the same family, we accept a lower raw token
 * overlap than we otherwise would.
 *
 * Grow this dictionary as the matcher surfaces false negatives — the
 * idea is that adding a single family entry can recover a whole class
 * of missed substitutions (e.g. "bar mixer" vs "shower mixer").
 *
 * Deterministic only — no regex magic beyond case-insensitive phrase
 * match against the description.
 */

/**
 * family key -> list of aliases / phrasings that belong to that family.
 * Matching is substring (case-insensitive) on the normalised description.
 */
export const PRODUCT_FAMILIES: Record<string, string[]> = {
  // ── Mixers / taps ────────────────────────────────────────────────────────
  "shower-mixer": [
    "shower mixer",
    "bar mixer",
    "bar mixer valve",
    "thermostatic bar",
    "thermostatic mixer",
    "thermo bar",
  ],
  "basin-tap": ["basin tap", "basin mixer", "pillar tap", "mono basin"],
  "kitchen-tap": ["kitchen tap", "kitchen mixer", "sink mixer", "swan neck"],
  "bath-tap": ["bath tap", "bath mixer", "bath filler", "bsm"],

  // ── Wc / sanitaryware ────────────────────────────────────────────────────
  "wc-cistern": [
    "wc cistern",
    "back to wall cistern",
    "concealed cistern",
    "low level cistern",
    "dual flush cistern",
  ],
  "wc-pan": ["wc pan", "toilet pan", "close coupled pan", "back to wall pan"],
  "wc-seat": ["wc seat", "toilet seat", "soft close seat"],
  "urinal": ["urinal", "urinal cistern", "urinal bowl"],

  // ── Pipe & fittings ──────────────────────────────────────────────────────
  "copper-tube": ["copper tube", "copper pipe", "x2 copper", "x3 copper"],
  "push-fit": ["push fit", "pushfit", "hep2o", "speedfit", "jg speedfit", "tectite"],
  "compression-fitting": [
    "compression fitting",
    "compression elbow",
    "compression tee",
    "compression coupler",
  ],
  "solder-fitting": ["solder ring", "endfeed", "end feed", "yorkshire"],
  "waste-pipe": [
    "waste pipe",
    "floplast waste",
    "pp waste",
    "abs waste",
    "mupvc waste",
    "solvent weld waste",
  ],
  "soil-pipe": ["soil pipe", "110mm soil", "push-fit soil", "single socket soil"],
  "pipe-insert": [
    "pipe insert",
    "smartsleeve",
    "pipe support liner",
    "pipe liner",
    "insert",
    "liner",
  ],
  "munsen-ring": ["munsen ring", "pipe clip", "hospital clip", "talon clip"],

  // ── Valves ───────────────────────────────────────────────────────────────
  "ball-valve": [
    "ball valve",
    "lever ball valve",
    "isolation valve",
    "quarter turn valve",
  ],
  "gate-valve": ["gate valve", "fullway gate", "wheel head gate"],
  "check-valve": ["check valve", "non return valve", "nrv", "double check"],
  "drain-valve": ["drain off", "drain cock", "draincock", "drain valve"],
  "prv": ["pressure reducing valve", "prv", "pressure reducer"],

  // ── Cylinders / heating ──────────────────────────────────────────────────
  "hot-water-cylinder": [
    "hot water cylinder",
    "unvented cylinder",
    "indirect cylinder",
    "direct cylinder",
    "megaflo",
    "megaflow",
  ],
  "radiator": ["radiator", "rad ", "panel radiator", "designer radiator"],
  "rad-valve": ["radiator valve", "rad valve", "trv", "lockshield"],
  "boiler": ["boiler", "combi boiler", "system boiler", "worcester", "vaillant", "ideal"],

  // ── Traps & waste ────────────────────────────────────────────────────────
  "bottle-trap": ["bottle trap", "sink trap", "basin trap", "p trap", "s trap"],
  "shower-trap": ["shower trap", "shower waste", "gully trap"],

  // ── Shower fittings ──────────────────────────────────────────────────────
  "shower-head": ["shower head", "overhead shower", "shower rose", "handset", "shower kit"],
  "shower-hose": ["shower hose", "flexi hose", "tap connector hose"],
  "shower-enclosure": ["shower enclosure", "shower tray", "shower door"],

  // ── Misc consumables ─────────────────────────────────────────────────────
  "sealant": ["silicone", "sealant", "ct1", "sanitary silicone"],
  "ptfe": ["ptfe", "thread tape", "ls-x", "boss white"],
  "flux": ["flux", "soldering flux", "powerflow"],
  "insulation": ["insulation", "pipe lagging", "armaflex", "climaflex"],
};

/** Reverse lookup: alias -> family key, precomputed. */
const ALIAS_TO_FAMILY = (() => {
  const map = new Map<string, string>();
  for (const [family, aliases] of Object.entries(PRODUCT_FAMILIES)) {
    for (const alias of aliases) {
      map.set(alias.toLowerCase(), family);
    }
  }
  return map;
})();

/**
 * Return the family key if the description matches any alias.
 * First hit wins — more specific families should be listed first when
 * you extend the dictionary.
 */
export function familyOf(description: string): string | null {
  if (!description) return null;
  const norm = description.toLowerCase();
  // Prefer longest alias hit to avoid e.g. "bath filler" winning over "bath tap"
  let best: { key: string; len: number } | null = null;
  for (const [alias, family] of ALIAS_TO_FAMILY.entries()) {
    if (norm.includes(alias)) {
      if (!best || alias.length > best.len) {
        best = { key: family, len: alias.length };
      }
    }
  }
  return best?.key ?? null;
}

/** True if both descriptions map to the same family. */
export function sameFamily(a: string, b: string): boolean {
  const fa = familyOf(a);
  if (!fa) return false;
  return fa === familyOf(b);
}

/**
 * Extract any numeric "sizes" from a description — e.g. "15mm", "22mm",
 * "3/4\"". Useful for boosting a match when both lines reference the
 * same bore / diameter.
 */
export function extractSizes(description: string): string[] {
  if (!description) return [];
  const out = new Set<string>();
  const re = /\b(\d{1,3})\s*(?:mm|"|inch|in)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    out.add(`${m[1]}mm`);
  }
  // Fractional sizes e.g. 1/2" 3/4"
  const frac = /\b(\d\/\d)\s*(?:"|inch|in)\b/gi;
  while ((m = frac.exec(description)) !== null) {
    out.add(m[1]);
  }
  return Array.from(out);
}

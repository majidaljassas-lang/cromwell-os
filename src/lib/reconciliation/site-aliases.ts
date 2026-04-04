/**
 * Site Aliasing
 *
 * Maps raw site labels to canonical site names.
 * Extendable — add more aliases as needed.
 */

const SITE_ALIAS_MAP: Record<string, string> = {
  "dellow centre": "DELLOW_CENTRE",
  "dellow": "DELLOW_CENTRE",
  "dc": "DELLOW_CENTRE",
  "shuttleworth - stratford": "DELLOW_CENTRE",
  "shuttleworth stratford": "DELLOW_CENTRE",
  "shuttleworth": "DELLOW_CENTRE",
  "stratford": "DELLOW_CENTRE",
};

export function canonicalizeSite(rawSite: string | null | undefined): { canonical: string; aliasUsed: boolean } {
  if (!rawSite) return { canonical: "UNKNOWN", aliasUsed: false };

  const lower = rawSite.toLowerCase().trim();

  // Exact match
  if (SITE_ALIAS_MAP[lower]) {
    const isExact = lower === Object.keys(SITE_ALIAS_MAP).find((k) => SITE_ALIAS_MAP[k] === SITE_ALIAS_MAP[lower] && k === lower.split(" ").slice(0, 2).join(" "));
    return { canonical: SITE_ALIAS_MAP[lower], aliasUsed: lower !== "dellow centre" };
  }

  // Partial match
  for (const [alias, canonical] of Object.entries(SITE_ALIAS_MAP)) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return { canonical, aliasUsed: true };
    }
  }

  return { canonical: rawSite, aliasUsed: false };
}

/**
 * Order Reference Parser
 *
 * Extracts useful tokens from invoice order_ref fields.
 */

export function parseOrderRef(orderRef: string | null | undefined): {
  raw: string | null;
  tokens: string[];
  dateHint: string | null;
  itemHint: string | null;
} {
  if (!orderRef) return { raw: null, tokens: [], dateHint: null, itemHint: null };

  const tokens = orderRef.split(/[\s,;\/\-]+/).filter((t) => t.length > 1);

  // Extract date hint
  let dateHint: string | null = null;
  const dateMatch = orderRef.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dateMatch) dateHint = dateMatch[0];

  // Extract item hints — look for product-like words
  const productWords = ["plasterboard", "board", "stud", "track", "insulation", "strap", "pipe", "tap", "valve", "screw", "filler", "plaster", "drylining", "drywall", "copper", "mlcp"];
  const itemTokens = tokens.filter((t) => productWords.some((pw) => t.toLowerCase().includes(pw)));
  const itemHint = itemTokens.length > 0 ? itemTokens.join(" ") : null;

  return { raw: orderRef, tokens, dateHint, itemHint };
}

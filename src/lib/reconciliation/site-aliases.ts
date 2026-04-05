/**
 * Site Aliasing — uses Site.aliases from database.
 * Canonical site = Site.siteName (single source of truth).
 * Aliases are for matching ONLY.
 */

import { prisma } from "@/lib/prisma";

let aliasCache: Map<string, { siteId: string; siteName: string }> | null = null;
let cacheTime = 0;

async function loadAliases(): Promise<Map<string, { siteId: string; siteName: string }>> {
  if (aliasCache && Date.now() - cacheTime < 60000) return aliasCache;

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, siteName: true, aliases: true },
  });

  const map = new Map<string, { siteId: string; siteName: string }>();
  for (const site of sites) {
    map.set(site.siteName.toLowerCase().trim(), { siteId: site.id, siteName: site.siteName });
    for (const alias of site.aliases) {
      map.set(alias.toLowerCase().trim(), { siteId: site.id, siteName: site.siteName });
    }
  }

  aliasCache = map;
  cacheTime = Date.now();
  return map;
}

export async function canonicalizeSiteAsync(rawSite: string | null | undefined): Promise<{
  canonical: string;
  siteId: string | null;
  aliasUsed: boolean;
}> {
  if (!rawSite) return { canonical: "UNKNOWN", siteId: null, aliasUsed: false };

  const lower = rawSite.toLowerCase().trim();
  const aliases = await loadAliases();

  const match = aliases.get(lower);
  if (match) {
    return {
      canonical: match.siteName,
      siteId: match.siteId,
      aliasUsed: lower !== match.siteName.toLowerCase().trim(),
    };
  }

  for (const [alias, data] of aliases) {
    if (lower.includes(alias) || alias.includes(lower)) {
      return { canonical: data.siteName, siteId: data.siteId, aliasUsed: true };
    }
  }

  return { canonical: rawSite, siteId: null, aliasUsed: false };
}

export function canonicalizeSite(rawSite: string | null | undefined): { canonical: string; aliasUsed: boolean } {
  if (!rawSite) return { canonical: "UNKNOWN", aliasUsed: false };
  return { canonical: rawSite, aliasUsed: false };
}

export function parseOrderRef(orderRef: string | null | undefined): {
  raw: string | null;
  tokens: string[];
  dateHint: string | null;
  itemHint: string | null;
} {
  if (!orderRef) return { raw: null, tokens: [], dateHint: null, itemHint: null };
  const tokens = orderRef.split(/[\s,;\/\-]+/).filter((t) => t.length > 1);
  const dateMatch = orderRef.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  const dateHint = dateMatch ? dateMatch[0] : null;
  const productWords = ["plasterboard", "board", "stud", "track", "insulation", "strap", "pipe", "tap", "valve", "screw", "filler", "plaster", "drylining", "drywall", "copper", "mlcp"];
  const itemTokens = tokens.filter((t) => productWords.some((pw) => t.toLowerCase().includes(pw)));
  const itemHint = itemTokens.length > 0 ? itemTokens.join(" ") : null;
  return { raw: orderRef, tokens, dateHint, itemHint };
}

export function clearSiteAliasCache() {
  aliasCache = null;
}

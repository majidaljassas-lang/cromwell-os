/**
 * Site Aliasing — uses Site.aliases + SiteAlias table from database.
 * Canonical site = Site.siteName (single source of truth).
 * Aliases are for matching ONLY.
 *
 * Strict matching rules:
 * - Exact match on siteName or alias → HIGH confidence
 * - Address number differentiation: "12 High St" !== "14 High St"
 * - If multiple sites match the same input → AMBIGUOUS_SITE_MATCH (no auto-resolve)
 * - Partial/substring matches → MEDIUM confidence, flagged for review
 */

import { prisma } from "@/lib/prisma";

type SiteEntry = {
  siteId: string;
  siteName: string;
  aliasText: string;
  isExact: boolean;
  manualConfirmed: boolean;
};

let aliasCache: SiteEntry[] | null = null;
let cacheTime = 0;

async function loadAliases(): Promise<SiteEntry[]> {
  if (aliasCache && Date.now() - cacheTime < 60000) return aliasCache;

  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, siteName: true, aliases: true },
  });

  const siteAliases = await prisma.siteAlias.findMany({
    where: { isActive: true },
    select: { siteId: true, aliasText: true, manualConfirmed: true, site: { select: { siteName: true } } },
  });

  const entries: SiteEntry[] = [];

  for (const site of sites) {
    // Canonical name is always exact
    entries.push({
      siteId: site.id,
      siteName: site.siteName,
      aliasText: site.siteName.toLowerCase().trim(),
      isExact: true,
      manualConfirmed: true,
    });
    // Legacy aliases array
    for (const alias of site.aliases) {
      entries.push({
        siteId: site.id,
        siteName: site.siteName,
        aliasText: alias.toLowerCase().trim(),
        isExact: true,
        manualConfirmed: false,
      });
    }
  }

  // SiteAlias table entries (higher authority)
  for (const sa of siteAliases) {
    entries.push({
      siteId: sa.siteId,
      siteName: sa.site.siteName,
      aliasText: sa.aliasText.toLowerCase().trim(),
      isExact: true,
      manualConfirmed: sa.manualConfirmed,
    });
  }

  aliasCache = entries;
  cacheTime = Date.now();
  return entries;
}

/** Extract address number from text, e.g. "12 High Street" → "12" */
function extractAddressNumber(text: string): string | null {
  const match = text.match(/^(\d+)\s/);
  return match ? match[1] : null;
}

/** Normalize text for comparison: lowercase, trim, collapse whitespace */
function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

export type SiteMatchResult = {
  canonical: string;
  siteId: string | null;
  aliasUsed: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchType: "EXACT" | "ALIAS_EXACT" | "PARTIAL" | "AMBIGUOUS" | "NONE";
  ambiguousCandidates?: Array<{ siteId: string; siteName: string }>;
  manualConfirmed: boolean;
};

export async function canonicalizeSiteAsync(rawSite: string | null | undefined): Promise<SiteMatchResult> {
  if (!rawSite) {
    return { canonical: "UNKNOWN", siteId: null, aliasUsed: false, confidence: "NONE", matchType: "NONE", manualConfirmed: false };
  }

  const lower = normalize(rawSite);
  const aliases = await loadAliases();
  const inputAddrNum = extractAddressNumber(lower);

  // Phase 1: Exact matches (siteName or alias text matches exactly)
  const exactMatches = aliases.filter((a) => a.aliasText === lower);

  if (exactMatches.length === 1) {
    const m = exactMatches[0];
    return {
      canonical: m.siteName,
      siteId: m.siteId,
      aliasUsed: lower !== m.siteName.toLowerCase().trim(),
      confidence: "HIGH",
      matchType: m.siteName.toLowerCase().trim() === lower ? "EXACT" : "ALIAS_EXACT",
      manualConfirmed: m.manualConfirmed,
    };
  }

  if (exactMatches.length > 1) {
    // Multiple exact matches = ambiguous (different sites, same alias)
    const uniqueSites = [...new Map(exactMatches.map((m) => [m.siteId, m])).values()];
    if (uniqueSites.length === 1) {
      // All match same site — not ambiguous
      const m = uniqueSites[0];
      return {
        canonical: m.siteName,
        siteId: m.siteId,
        aliasUsed: true,
        confidence: "HIGH",
        matchType: "ALIAS_EXACT",
        manualConfirmed: m.manualConfirmed,
      };
    }
    // Genuinely ambiguous
    return {
      canonical: rawSite,
      siteId: null,
      aliasUsed: false,
      confidence: "LOW",
      matchType: "AMBIGUOUS",
      ambiguousCandidates: uniqueSites.map((s) => ({ siteId: s.siteId, siteName: s.siteName })),
      manualConfirmed: false,
    };
  }

  // Phase 2: Partial/substring matches with address number check
  const partialMatches: SiteEntry[] = [];
  for (const entry of aliases) {
    if (lower.includes(entry.aliasText) || entry.aliasText.includes(lower)) {
      // Address number guard: if both have an address number, they must match
      const entryAddrNum = extractAddressNumber(entry.aliasText);
      if (inputAddrNum && entryAddrNum && inputAddrNum !== entryAddrNum) {
        continue; // Skip — different address numbers
      }
      partialMatches.push(entry);
    }
  }

  // Deduplicate by site
  const uniquePartials = [...new Map(partialMatches.map((m) => [m.siteId, m])).values()];

  if (uniquePartials.length === 1) {
    const m = uniquePartials[0];
    return {
      canonical: m.siteName,
      siteId: m.siteId,
      aliasUsed: true,
      confidence: "MEDIUM",
      matchType: "PARTIAL",
      manualConfirmed: m.manualConfirmed,
    };
  }

  if (uniquePartials.length > 1) {
    // Ambiguous partial match
    return {
      canonical: rawSite,
      siteId: null,
      aliasUsed: false,
      confidence: "LOW",
      matchType: "AMBIGUOUS",
      ambiguousCandidates: uniquePartials.map((s) => ({ siteId: s.siteId, siteName: s.siteName })),
      manualConfirmed: false,
    };
  }

  // No match
  return {
    canonical: rawSite,
    siteId: null,
    aliasUsed: false,
    confidence: "NONE",
    matchType: "NONE",
    manualConfirmed: false,
  };
}

/** Synchronous fallback — no DB access, returns raw input */
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

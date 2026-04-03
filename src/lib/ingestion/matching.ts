/**
 * Matching Engine — Scoring Model
 *
 * Weighted score: same contact 30, same site/alias 25, product similarity 20,
 * date proximity 15, prior historical mapping 10.
 *
 * Thresholds: 80+ auto-suggest, 60-79 review queue, <60 manual review.
 * Score returns numeric confidence AND machine-readable reasons.
 * Manual overrides captured for future learning.
 */

import { prisma } from "@/lib/prisma";

export interface MatchResult {
  entityId: string;
  entityType: string;
  entityName: string;
  confidence: number;
  reasons: MatchReason[];
}

export interface MatchReason {
  factor: string;
  weight: number;
  detail: string;
}

// ─── Site Matching ──────────────────────────────────────────────────────────

export async function matchSite(rawSiteText: string): Promise<MatchResult[]> {
  const normalised = rawSiteText.toLowerCase().trim();
  const results: MatchResult[] = [];

  // 1. Exact alias match (weight: 25)
  const exactAliases = await prisma.siteAlias.findMany({
    where: { aliasText: { equals: normalised, mode: "insensitive" }, isActive: true },
    include: { site: { select: { id: true, siteName: true } } },
  });

  for (const alias of exactAliases) {
    results.push({
      entityId: alias.site.id,
      entityType: "Site",
      entityName: alias.site.siteName,
      confidence: Number(alias.confidenceDefault ?? 90),
      reasons: [{ factor: "EXACT_ALIAS", weight: 25, detail: `Exact alias match: "${alias.aliasText}"` }],
    });
  }

  if (results.length > 0) return results;

  // 2. Fuzzy alias match — contains (weight: 20)
  const fuzzyAliases = await prisma.siteAlias.findMany({
    where: {
      isActive: true,
      OR: [
        { aliasText: { contains: normalised, mode: "insensitive" } },
        { aliasText: { startsWith: normalised.split(" ")[0], mode: "insensitive" } },
      ],
    },
    include: { site: { select: { id: true, siteName: true } } },
  });

  for (const alias of fuzzyAliases) {
    const similarity = calculateSimilarity(normalised, alias.aliasText.toLowerCase());
    results.push({
      entityId: alias.site.id,
      entityType: "Site",
      entityName: alias.site.siteName,
      confidence: Math.round(similarity * 80),
      reasons: [{ factor: "FUZZY_ALIAS", weight: 20, detail: `Fuzzy alias: "${alias.aliasText}" (${Math.round(similarity * 100)}% similar)` }],
    });
  }

  // 3. Direct site name match (weight: 25)
  const siteMatches = await prisma.site.findMany({
    where: {
      OR: [
        { siteName: { contains: normalised, mode: "insensitive" } },
        { siteCode: { equals: normalised, mode: "insensitive" } },
      ],
    },
    select: { id: true, siteName: true, siteCode: true },
  });

  for (const site of siteMatches) {
    const nameMatch = site.siteName.toLowerCase().includes(normalised) || normalised.includes(site.siteName.toLowerCase());
    const similarity = calculateSimilarity(normalised, site.siteName.toLowerCase());
    if (!results.find((r) => r.entityId === site.id)) {
      results.push({
        entityId: site.id,
        entityType: "Site",
        entityName: site.siteName,
        confidence: Math.round(similarity * 85),
        reasons: [{
          factor: nameMatch ? "SITE_NAME_MATCH" : "SITE_CODE_MATCH",
          weight: 25,
          detail: `Site name match: "${site.siteName}" (${Math.round(similarity * 100)}% similar)`,
        }],
      });
    }
  }

  // 4. Postcode-based matching (weight: 15)
  const postcodeMatch = rawSiteText.match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i);
  if (postcodeMatch) {
    const postcode = postcodeMatch[0].toUpperCase().replace(/\s+/, " ");
    const postcodeSites = await prisma.site.findMany({
      where: { postcode: { contains: postcode.split(" ")[0], mode: "insensitive" } },
      select: { id: true, siteName: true, postcode: true },
    });
    for (const site of postcodeSites) {
      const existing = results.find((r) => r.entityId === site.id);
      if (existing) {
        existing.confidence = Math.min(existing.confidence + 15, 95);
        existing.reasons.push({ factor: "POSTCODE_MATCH", weight: 15, detail: `Postcode match: ${site.postcode}` });
      } else {
        results.push({
          entityId: site.id,
          entityType: "Site",
          entityName: site.siteName,
          confidence: 50,
          reasons: [{ factor: "POSTCODE_MATCH", weight: 15, detail: `Postcode match: ${site.postcode}` }],
        });
      }
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Customer Matching ──────────────────────────────────────────────────────

export async function matchCustomer(rawCustomerText: string): Promise<MatchResult[]> {
  const normalised = rawCustomerText.toLowerCase().trim();
  const results: MatchResult[] = [];

  // 1. Exact alias match
  const exactAliases = await prisma.customerAlias.findMany({
    where: { aliasText: { equals: normalised, mode: "insensitive" }, isActive: true },
    include: { customer: { select: { id: true, name: true } } },
  });

  for (const alias of exactAliases) {
    results.push({
      entityId: alias.customer.id,
      entityType: "Customer",
      entityName: alias.customer.name,
      confidence: 90,
      reasons: [{ factor: "EXACT_ALIAS", weight: 25, detail: `Exact alias match: "${alias.aliasText}"` }],
    });
  }

  if (results.length > 0) return results;

  // 2. Fuzzy alias match
  const fuzzyAliases = await prisma.customerAlias.findMany({
    where: {
      isActive: true,
      OR: [
        { aliasText: { contains: normalised, mode: "insensitive" } },
        { aliasText: { startsWith: normalised.split(" ")[0], mode: "insensitive" } },
      ],
    },
    include: { customer: { select: { id: true, name: true } } },
  });

  for (const alias of fuzzyAliases) {
    const similarity = calculateSimilarity(normalised, alias.aliasText.toLowerCase());
    if (!results.find((r) => r.entityId === alias.customer.id)) {
      results.push({
        entityId: alias.customer.id,
        entityType: "Customer",
        entityName: alias.customer.name,
        confidence: Math.round(similarity * 80),
        reasons: [{ factor: "FUZZY_ALIAS", weight: 20, detail: `Fuzzy alias: "${alias.aliasText}"` }],
      });
    }
  }

  // 3. Direct customer name match
  const customerMatches = await prisma.customer.findMany({
    where: {
      OR: [
        { name: { contains: normalised, mode: "insensitive" } },
        { legalName: { contains: normalised, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, legalName: true },
  });

  for (const cust of customerMatches) {
    if (!results.find((r) => r.entityId === cust.id)) {
      const similarity = calculateSimilarity(normalised, cust.name.toLowerCase());
      results.push({
        entityId: cust.id,
        entityType: "Customer",
        entityName: cust.name,
        confidence: Math.round(similarity * 85),
        reasons: [{ factor: "NAME_MATCH", weight: 25, detail: `Customer name match: "${cust.name}"` }],
      });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Contact Matching ───────────────────────────────────────────────────────

export async function matchContact(phone?: string, email?: string, name?: string): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  if (phone) {
    const cleaned = phone.replace(/\s/g, "");
    const contacts = await prisma.contact.findMany({
      where: { phone: { contains: cleaned.slice(-8) } },
      select: { id: true, fullName: true, phone: true },
    });
    for (const c of contacts) {
      results.push({
        entityId: c.id,
        entityType: "Contact",
        entityName: c.fullName,
        confidence: 85,
        reasons: [{ factor: "PHONE_MATCH", weight: 30, detail: `Phone match: ${c.phone}` }],
      });
    }
  }

  if (email) {
    const contacts = await prisma.contact.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, fullName: true, email: true },
    });
    for (const c of contacts) {
      const existing = results.find((r) => r.entityId === c.id);
      if (existing) {
        existing.confidence = Math.min(existing.confidence + 30, 99);
        existing.reasons.push({ factor: "EMAIL_MATCH", weight: 30, detail: `Email match: ${c.email}` });
      } else {
        results.push({
          entityId: c.id,
          entityType: "Contact",
          entityName: c.fullName,
          confidence: 90,
          reasons: [{ factor: "EMAIL_MATCH", weight: 30, detail: `Email match: ${c.email}` }],
        });
      }
    }
  }

  if (name && results.length === 0) {
    const contacts = await prisma.contact.findMany({
      where: { fullName: { contains: name, mode: "insensitive" } },
      select: { id: true, fullName: true },
    });
    for (const c of contacts) {
      results.push({
        entityId: c.id,
        entityType: "Contact",
        entityName: c.fullName,
        confidence: 60,
        reasons: [{ factor: "NAME_MATCH", weight: 15, detail: `Name match: "${c.fullName}"` }],
      });
    }
  }

  results.sort((a, b) => b.confidence - a.confidence);
  return results;
}

// ─── Similarity ─────────────────────────────────────────────────────────────

function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Containment check
  if (a.includes(b) || b.includes(a)) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  }

  // Word overlap
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;

  return union > 0 ? intersection / union : 0;
}

/**
 * Site / customer anchor matcher for supplier ack matching.
 *
 * Given a grab-bag of free-text signals extracted from a supplier doc
 * (customer ref, PO ref, subject line, sender domain, body snippet),
 * find the best active ticket to anchor the doc to.
 *
 * Deterministic only — no LLM calls. Uses exact + fuzzy matching on
 * site names, site aliases, customer names, and any known
 * ProcurementOrder.poNo / supplierRef values.
 *
 * Designed to be hand-rolled: no new npm deps.
 */

import type { PrismaClient } from "@/generated/prisma";

// ─── Public types ────────────────────────────────────────────────────────────

export interface AnchorSignals {
  customerRef?: string | null;
  poRef?: string | null;
  subject?: string | null;
  bodySnippet?: string | null;
  senderDomain?: string | null;
}

export interface AnchorMatch {
  ticketId: string;
  ticketNo: number;
  siteId: string | null;
  siteName: string | null;
  confidence: "high" | "medium" | "low";
  matchedOn: string; // human-readable explanation
  score: number;
}

// ─── Fuzzy helpers (hand-rolled, no deps) ────────────────────────────────────

/** Normalise a string for comparison: lowercase, strip non-alnum, collapse whitespace. */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-split a normalised string into meaningful tokens (≥2 chars). */
export function tokenise(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((t) => t.length >= 2);
}

/** Levenshtein distance — classic iterative DP, O(m·n) time, O(n) space. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev: number[] = new Array(b.length + 1);
  const curr: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** True if a token appears in haystack within edit distance `maxDist`. */
export function fuzzyTokenHit(token: string, haystack: string[], maxDist = 2): boolean {
  if (token.length < 4) {
    // Short tokens must match exactly — Levenshtein is too permissive.
    return haystack.includes(token);
  }
  const limit = Math.min(maxDist, Math.floor(token.length / 3));
  for (const h of haystack) {
    if (h === token) return true;
    if (Math.abs(h.length - token.length) > limit) {
      // Allow containment for longer haystack tokens — handles PDF
      // text where whitespace has been lost ("MajidShuttleworth").
      if (token.length >= 6 && h.length > token.length && h.includes(token)) {
        return true;
      }
      continue;
    }
    if (levenshtein(h, token) <= limit) return true;
  }
  // Final fallback — scan the joined haystack string for a fuzzy hit on
  // the same-length window. Useful for PDF text where diacritics/spacing
  // have been stripped but the underlying letters remain.
  if (token.length >= 6) {
    const joined = haystack.join(" ");
    if (joined.includes(token)) return true;
  }
  return false;
}

/**
 * Multi-word phrase match: count how many tokens of `needle` have a fuzzy
 * hit in `haystack`. Returns a ratio 0..1.
 */
export function phraseOverlap(needle: string, haystack: string): number {
  const needleTokens = tokenise(needle);
  if (needleTokens.length === 0) return 0;
  const haystackTokens = tokenise(haystack);
  if (haystackTokens.length === 0) return 0;

  let hits = 0;
  for (const t of needleTokens) {
    if (fuzzyTokenHit(t, haystackTokens, 2)) hits++;
  }
  return hits / needleTokens.length;
}

/**
 * Check if `haystack` contains a fuzzy version of `siteName`.
 * Requires at least one "site-identifying" token (length >= 5) to fuzzy-match
 * and at least 60% of site tokens to match overall.
 */
// Common English stopwords we should not count as "identifying" site tokens.
const STOPWORDS = new Set([
  "hostel",
  "hotel",
  "house",
  "road",
  "street",
  "lane",
  "avenue",
  "close",
  "ltd",
  "limited",
  "building",
  "site",
  "the",
  "and",
  "of",
  "for",
  "center",
  "centre",
  "bar",
  "new",
  "old",
]);

export function siteNameFuzzyHit(
  siteName: string,
  haystack: string
): { hit: boolean; score: number; reason: string } {
  const siteTokens = tokenise(siteName).filter((t) => t.length >= 3);
  if (siteTokens.length === 0) return { hit: false, score: 0, reason: "" };

  const hayTokens = tokenise(haystack);
  if (hayTokens.length === 0) return { hit: false, score: 0, reason: "" };

  // Identifying tokens are the non-stopword, longish ones (>=5) — these
  // are what make a site name unique. A hit on one of these alone is
  // enough to claim a site match.
  const identifying = siteTokens.filter(
    (t) => t.length >= 5 && !STOPWORDS.has(t)
  );

  let hits = 0;
  let idHits = 0;
  const matchedTokens: string[] = [];

  for (const t of siteTokens) {
    if (fuzzyTokenHit(t, hayTokens, 2)) {
      hits++;
      matchedTokens.push(t);
      if (t.length >= 5 && !STOPWORDS.has(t)) idHits++;
    }
  }

  const ratio = hits / siteTokens.length;
  // Primary rule: any identifying-token hit counts as a site match.
  // Fallback rule: if there are no identifying tokens (e.g. numeric only),
  // require the old 60% ratio over the full set.
  const hit =
    (identifying.length > 0 && idHits > 0) ||
    (identifying.length === 0 && ratio >= 0.6);

  return {
    hit,
    score: Math.max(ratio, idHits > 0 ? 0.7 : ratio),
    reason: hit
      ? `site tokens [${matchedTokens.join(",")}] fuzzy match${idHits > 0 ? " (identifying)" : ""}`
      : "",
  };
}

// ─── Main anchor entry point ─────────────────────────────────────────────────

/**
 * Light shape we pull from Prisma. Keeping this narrow avoids select-drift
 * when other agents add columns.
 */
interface CandidateTicket {
  id: string;
  ticketNo: number;
  siteId: string | null;
  siteName: string | null;
  siteAliases: string[];
  customerName: string | null;
  customerAliases: string[];
  poNumbers: string[]; // ProcurementOrder.poNo + supplierRef already lowered
}

async function loadCandidates(
  prisma: PrismaClient
): Promise<CandidateTicket[]> {
  const tickets = await prisma.ticket.findMany({
    where: {
      status: {
        notIn: [
          "CLOSED",
          "INVOICED",
          "LOCKED",
          "VERIFIED",
        ] as any,
      },
    },
    select: {
      id: true,
      ticketNo: true,
      siteId: true,
      site: {
        select: {
          id: true,
          siteName: true,
          aliases: true,
          siteAliases: { select: { aliasText: true, isActive: true } },
        },
      },
      payingCustomer: {
        select: {
          id: true,
          name: true,
          customerAliases: { select: { aliasText: true, isActive: true } },
        },
      },
      procurementOrders: {
        select: { poNo: true, supplierRef: true },
      },
    },
  });

  return tickets.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    siteId: t.siteId,
    siteName: t.site?.siteName ?? null,
    siteAliases: [
      ...(t.site?.aliases ?? []),
      ...((t.site?.siteAliases ?? [])
        .filter((a) => a.isActive)
        .map((a) => a.aliasText)),
    ],
    customerName: t.payingCustomer?.name ?? null,
    customerAliases: (t.payingCustomer?.customerAliases ?? [])
      .filter((a) => a.isActive)
      .map((a) => a.aliasText),
    poNumbers: t.procurementOrders
      .flatMap((p) => [p.poNo, p.supplierRef ?? ""])
      .filter(Boolean)
      .map((s) => s.toLowerCase()),
  }));
}

/**
 * Build the master "haystack" text from all provided signals.
 */
function buildHaystack(signals: AnchorSignals): string {
  return [
    signals.customerRef,
    signals.poRef,
    signals.subject,
    signals.bodySnippet,
  ]
    .filter(Boolean)
    .join(" \n ");
}

/** Extract any PO-number-shaped tokens from the signals. */
function extractPoCandidates(signals: AnchorSignals): string[] {
  const out = new Set<string>();
  const pushRef = (s?: string | null) => {
    if (!s) return;
    out.add(s.trim().toLowerCase());
  };
  pushRef(signals.poRef);
  pushRef(signals.customerRef);

  // Also mine the subject/body for PO-ish tokens.
  const combined = [signals.subject, signals.bodySnippet]
    .filter(Boolean)
    .join(" ");
  const regex = /\b(?:PO[-\s]?|P\.O\.?\s?|Order\s*(?:No\.?|Number|Ref)?\s*:?\s*|Ref\s*[:\s]+)([A-Z0-9][A-Z0-9/\-_.]{2,})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(combined)) !== null) {
    out.add(m[1].trim().toLowerCase());
  }
  // Also bare Cromwell-style "S.977281" / "T18" / plain numeric runs ≥5 digits
  const bareRegex = /\b([A-Z]{1,2}[.\-\/]?\d{4,}|\d{5,})\b/g;
  while ((m = bareRegex.exec(combined)) !== null) {
    out.add(m[1].trim().toLowerCase());
  }
  return Array.from(out);
}

/**
 * The main anchor function. Given signals and an initialised prisma client,
 * returns the best ticket match or null.
 *
 * Strategy (first winner by confidence tier):
 *   HIGH    a) PO ref exact match against ProcurementOrder.poNo / supplierRef
 *           b) Site name / site alias fuzzy hit in any of the signals
 *   MEDIUM  c) Customer name / alias match
 *   LOW     (caller decides what to do with a weak hit — we still return it)
 */
export async function anchorToTicket(
  prisma: PrismaClient,
  signals: AnchorSignals
): Promise<AnchorMatch | null> {
  const candidates = await loadCandidates(prisma);
  if (candidates.length === 0) return null;

  const haystack = buildHaystack(signals);
  const poNeedles = extractPoCandidates(signals);

  let best: AnchorMatch | null = null;

  // ── Tier A: exact PO number match ─────────────────────────────────────────
  // Requires either a full equality OR the PO token to appear as a
  // whole-word hit inside the needle (or vice versa). This prevents
  // "s.977226-mirel-portion" from matching "s.977226" just because the
  // latter is a prefix of the former.
  const wordBoundaryHit = (outer: string, inner: string): boolean => {
    if (outer === inner) return true;
    if (inner.length < 4) return false;
    const re = new RegExp(
      `(^|[^a-z0-9])${inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`,
      "i"
    );
    return re.test(outer);
  };
  for (const t of candidates) {
    if (t.poNumbers.length === 0) continue;
    for (const needle of poNeedles) {
      if (!needle || needle.length < 4) continue;
      for (const po of t.poNumbers) {
        if (po.length < 4) continue;
        const equal = po === needle;
        const poInNeedle = wordBoundaryHit(needle, po);
        const needleInPo = wordBoundaryHit(po, needle);
        if (equal || poInNeedle || needleInPo) {
          const m: AnchorMatch = {
            ticketId: t.id,
            ticketNo: t.ticketNo,
            siteId: t.siteId,
            siteName: t.siteName,
            confidence: "high",
            matchedOn: `PO number exact match: ${po}`,
            score: 1.0,
          };
          if (!best || m.score > best.score) best = m;
        }
      }
    }
  }
  if (best) return best;

  // ── Tier B: site name / alias fuzzy match ────────────────────────────────
  for (const t of candidates) {
    if (!t.siteName) continue;

    // Exact site name hit (case-insensitive) in haystack
    const normHay = normalise(haystack);
    if (normHay.includes(normalise(t.siteName))) {
      const m: AnchorMatch = {
        ticketId: t.id,
        ticketNo: t.ticketNo,
        siteId: t.siteId,
        siteName: t.siteName,
        confidence: "high",
        matchedOn: `site name exact: ${t.siteName}`,
        score: 0.98,
      };
      if (!best || m.score > best.score) best = m;
      continue;
    }

    // Exact alias hit
    let aliasHit: string | null = null;
    for (const alias of t.siteAliases) {
      if (normHay.includes(normalise(alias))) {
        aliasHit = alias;
        break;
      }
    }
    if (aliasHit) {
      const m: AnchorMatch = {
        ticketId: t.id,
        ticketNo: t.ticketNo,
        siteId: t.siteId,
        siteName: t.siteName,
        confidence: "high",
        matchedOn: `site alias exact: ${aliasHit}`,
        score: 0.95,
      };
      if (!best || m.score > best.score) best = m;
      continue;
    }

    // Fuzzy site name match (handles "Shuttlworth" -> "Shuttleworth")
    const fuzzy = siteNameFuzzyHit(t.siteName, haystack);
    if (fuzzy.hit) {
      const m: AnchorMatch = {
        ticketId: t.id,
        ticketNo: t.ticketNo,
        siteId: t.siteId,
        siteName: t.siteName,
        confidence: "high",
        matchedOn: `site fuzzy: ${fuzzy.reason}`,
        score: 0.85 + fuzzy.score * 0.1,
      };
      if (!best || m.score > best.score) best = m;
      continue;
    }

    // Fuzzy alias match
    for (const alias of t.siteAliases) {
      const f = siteNameFuzzyHit(alias, haystack);
      if (f.hit) {
        const m: AnchorMatch = {
          ticketId: t.id,
          ticketNo: t.ticketNo,
          siteId: t.siteId,
          siteName: t.siteName,
          confidence: "high",
          matchedOn: `alias fuzzy (${alias}): ${f.reason}`,
          score: 0.82 + f.score * 0.1,
        };
        if (!best || m.score > best.score) best = m;
        break;
      }
    }
  }
  if (best && best.confidence === "high") return best;

  // ── Tier C: customer name match (medium) ─────────────────────────────────
  for (const t of candidates) {
    if (!t.customerName) continue;
    const overlap = phraseOverlap(t.customerName, haystack);
    if (overlap >= 0.6) {
      const m: AnchorMatch = {
        ticketId: t.id,
        ticketNo: t.ticketNo,
        siteId: t.siteId,
        siteName: t.siteName,
        confidence: "medium",
        matchedOn: `customer name overlap ${overlap.toFixed(2)}`,
        score: 0.5 + overlap * 0.2,
      };
      if (!best || m.score > best.score) best = m;
    }
    for (const alias of t.customerAliases) {
      const overlap2 = phraseOverlap(alias, haystack);
      if (overlap2 >= 0.6) {
        const m: AnchorMatch = {
          ticketId: t.id,
          ticketNo: t.ticketNo,
          siteId: t.siteId,
          siteName: t.siteName,
          confidence: "medium",
          matchedOn: `customer alias overlap ${overlap2.toFixed(2)}`,
          score: 0.48 + overlap2 * 0.2,
        };
        if (!best || m.score > best.score) best = m;
      }
    }
  }

  return best;
}

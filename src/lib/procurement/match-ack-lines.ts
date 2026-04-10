/**
 * Line matcher for supplier order acknowledgements.
 *
 * Given:
 *   supplyLines  — lines parsed from the supplier doc (ParsedAckLine[])
 *   demandLines  — open ticket lines from the anchored ticket
 *
 * Produces a structured match result:
 *   - each supply line is labelled exact / substitution / extra
 *   - each demand line with no supply match is labelled missing
 *
 * Scoring is deterministic: Jaccard on description tokens + boosts
 * for qty, unit, product family and numeric size matches.
 *
 * Never throws.
 */

import type { ParsedAckLine } from "./parse-acknowledgement";
import { sameFamily, extractSizes } from "./product-taxonomy";

// ─── Public types ────────────────────────────────────────────────────────────

export interface DemandLine {
  id: string;
  description: string;
  qty: number;
  unit: string;
  normalizedItemName?: string | null;
}

export interface LineMatch {
  supplyLine: ParsedAckLine;
  demandLineId: string | null;
  demandLineDescription: string | null;
  matchType: "exact" | "substitution" | "extra";
  score: number;
  reason: string;
}

export interface MissingLine {
  ticketLineId: string;
  description: string;
  qty: number;
}

export interface MatchResult {
  matches: LineMatch[];
  missing: MissingLine[];
  stats: {
    exact: number;
    substitution: number;
    extra: number;
    missing: number;
  };
}

// ─── Scoring helpers ────────────────────────────────────────────────────────

function normalise(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenise(s: string): Set<string> {
  return new Set(
    normalise(s)
      .split(" ")
      .filter((t) => t.length > 2)
  );
}

/** Pure Jaccard similarity on token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  const union = new Set<string>();
  a.forEach((t) => union.add(t));
  b.forEach((t) => union.add(t));
  return overlap / union.size;
}

function scorePair(
  supply: ParsedAckLine,
  demand: DemandLine
): { score: number; reason: string } {
  const supplyDesc = supply.description || "";
  const demandDesc = demand.normalizedItemName || demand.description || "";

  const a = tokenise(supplyDesc);
  const b = tokenise(demandDesc);
  const base = jaccard(a, b);

  let score = base;
  const reasons: string[] = [`jaccard=${base.toFixed(2)}`];

  // Qty exact match boost
  if (
    supply.qty > 0 &&
    demand.qty > 0 &&
    Math.abs(supply.qty - demand.qty) < 0.0001
  ) {
    score += 0.15;
    reasons.push("qty=");
  } else if (
    supply.qty > 0 &&
    demand.qty > 0 &&
    Math.abs(supply.qty - demand.qty) / Math.max(supply.qty, demand.qty) < 0.1
  ) {
    // Within 10% — common for pack/each confusion
    score += 0.05;
    reasons.push("qty~");
  }

  // Product code prefix boost
  if (supply.productCode && demandDesc) {
    const code = supply.productCode.toLowerCase();
    if (normalise(demandDesc).includes(code.toLowerCase())) {
      score += 0.2;
      reasons.push("code");
    }
  }

  // Same product family boost
  if (sameFamily(supplyDesc, demandDesc)) {
    score += 0.2;
    reasons.push("family");
  }

  // Numeric size (e.g. 15mm) overlap boost
  const supplySizes = extractSizes(supplyDesc);
  const demandSizes = extractSizes(demandDesc);
  if (supplySizes.length > 0 && demandSizes.length > 0) {
    const sharedSize = supplySizes.find((s) => demandSizes.includes(s));
    if (sharedSize) {
      score += 0.15;
      reasons.push(`size=${sharedSize}`);
    }
  }

  return { score, reason: reasons.join("+") };
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function matchAckLines(
  supplyLines: ParsedAckLine[],
  demandLines: DemandLine[]
): MatchResult {
  const matches: LineMatch[] = [];
  const usedDemand = new Set<string>();

  for (const supply of supplyLines) {
    let bestScore = 0;
    let bestDemand: DemandLine | null = null;
    let bestReason = "";

    for (const demand of demandLines) {
      if (usedDemand.has(demand.id)) continue; // one-to-one matching
      const { score, reason } = scorePair(supply, demand);
      if (score > bestScore) {
        bestScore = score;
        bestDemand = demand;
        bestReason = reason;
      }
    }

    let matchType: "exact" | "substitution" | "extra";
    if (bestScore >= 0.65 && bestDemand) {
      matchType = "exact";
      usedDemand.add(bestDemand.id);
    } else if (bestScore >= 0.45 && bestDemand) {
      matchType = "substitution";
      usedDemand.add(bestDemand.id);
    } else {
      matchType = "extra";
      bestDemand = null;
    }

    matches.push({
      supplyLine: supply,
      demandLineId: bestDemand?.id ?? null,
      demandLineDescription: bestDemand?.description ?? null,
      matchType,
      score: Number(bestScore.toFixed(3)),
      reason: bestReason || "no overlap",
    });
  }

  const missing: MissingLine[] = demandLines
    .filter((d) => !usedDemand.has(d.id))
    .map((d) => ({
      ticketLineId: d.id,
      description: d.description,
      qty: d.qty,
    }));

  const stats = {
    exact: matches.filter((m) => m.matchType === "exact").length,
    substitution: matches.filter((m) => m.matchType === "substitution").length,
    extra: matches.filter((m) => m.matchType === "extra").length,
    missing: missing.length,
  };

  return { matches, missing, stats };
}

/**
 * Smart supplier name resolver.
 *
 * Lookup order for a typed string:
 *   1. Exact name match (case-insensitive)
 *   2. Exact alias match (case-insensitive) on SupplierAlias.alias
 *   3. Trigram similarity (pg_trgm) against Supplier.name and SupplierAlias.alias
 *
 * Score thresholds:
 *   ≥ 0.75 → AUTO_MERGE — pick best, record typed string as alias if not already
 *   0.55–0.74 → CONFIRM — return candidates so the UI can ask the user
 *   < 0.55 → NEW — caller should create a fresh Supplier
 *
 * Used by:
 *   - PATCH /api/ticket-lines/[id] when a user types a supplier name on a line
 */
import { prisma } from "@/lib/prisma";

const AUTO_MERGE_THRESHOLD = 0.75;
const GREY_ZONE_MIN = 0.55;

export type SupplierMatchStatus = "EXACT" | "ALIAS" | "AUTO_MERGE" | "CONFIRM" | "NEW";

export type SupplierMatchCandidate = {
  id: string;
  name: string;
  score: number;
  matchedOn: "name" | "alias";
  matchedText: string;
};

export type SupplierMatchResult = {
  status: SupplierMatchStatus;
  typed: string;
  supplier?: { id: string; name: string };
  candidates?: SupplierMatchCandidate[];
};

export async function resolveSupplier(typedRaw: string): Promise<SupplierMatchResult> {
  const typed = typedRaw.trim();
  if (!typed) return { status: "NEW", typed };

  // 1. Exact name (case-insensitive)
  const exact = await prisma.supplier.findFirst({
    where: { name: { equals: typed, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (exact) return { status: "EXACT", typed, supplier: exact };

  // 2. Exact alias (case-insensitive)
  const aliasHit = await prisma.supplierAlias.findFirst({
    where: { alias: { equals: typed, mode: "insensitive" } },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (aliasHit) return { status: "ALIAS", typed, supplier: aliasHit.supplier };

  // 3. Fuzzy: max of trigram similarity (typo case) and word_similarity (short→long case,
  //    e.g. "Astro" inside "Astro Lighting"). pg_trgm.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; name: string; score: number; matched_on: "name" | "alias"; matched_text: string }>
  >`
    SELECT id, name, score, matched_on, matched_text FROM (
      SELECT s.id, s.name,
             GREATEST(similarity(s.name, ${typed}), word_similarity(${typed}, s.name)) AS score,
             'name'::text AS matched_on, s.name AS matched_text
        FROM "Supplier" s
       WHERE GREATEST(similarity(s.name, ${typed}), word_similarity(${typed}, s.name)) > ${GREY_ZONE_MIN}
      UNION ALL
      SELECT s.id, s.name,
             GREATEST(similarity(a.alias, ${typed}), word_similarity(${typed}, a.alias)) AS score,
             'alias'::text AS matched_on, a.alias AS matched_text
        FROM "SupplierAlias" a
        JOIN "Supplier" s ON s.id = a."supplierId"
       WHERE GREATEST(similarity(a.alias, ${typed}), word_similarity(${typed}, a.alias)) > ${GREY_ZONE_MIN}
    ) m
    ORDER BY score DESC
    LIMIT 5;
  `;

  if (rows.length === 0) return { status: "NEW", typed };

  // Collapse duplicate suppliers, keeping the best score per supplier.
  const bestPerSupplier = new Map<string, SupplierMatchCandidate>();
  for (const r of rows) {
    const existing = bestPerSupplier.get(r.id);
    if (!existing || r.score > existing.score) {
      bestPerSupplier.set(r.id, {
        id: r.id,
        name: r.name,
        score: Number(r.score),
        matchedOn: r.matched_on,
        matchedText: r.matched_text,
      });
    }
  }
  const candidates = [...bestPerSupplier.values()].sort((a, b) => b.score - a.score);
  const top = candidates[0];

  if (top.score >= AUTO_MERGE_THRESHOLD) {
    return { status: "AUTO_MERGE", typed, supplier: { id: top.id, name: top.name }, candidates };
  }
  return { status: "CONFIRM", typed, candidates };
}

/** Record the typed string as an alias against a supplier (idempotent). */
export async function recordAlias(supplierId: string, alias: string, source: "USER" | "SYSTEM" = "USER") {
  const trimmed = alias.trim();
  if (!trimmed) return;
  await prisma.supplierAlias.upsert({
    where: { supplierId_alias: { supplierId, alias: trimmed } },
    update: { observationCount: { increment: 1 }, lastSeenAt: new Date() },
    create: { supplierId, alias: trimmed, source, observationCount: 1, lastSeenAt: new Date() },
  });
}

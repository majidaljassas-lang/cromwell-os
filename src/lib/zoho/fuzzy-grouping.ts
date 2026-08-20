/**
 * Token-based Jaccard clustering for spelling variants.
 *
 * Used by the cleanup workspace to suggest groups of CF.Site strings or
 * Zoho customer names that probably refer to the same OS entity. Pure
 * heuristic — every group still requires user confirmation before linking.
 */

const STOPWORDS = new Set([
  "the", "and", "of", "at", "in", "on", "to",
  "ltd", "limited", "llp", "plc", "uk", "co", "company", "inc",
  "&",
  "construction", "developments", "hospitality", "services",
  "site", "sites", "house", "court", "street", "road", "lane", "gardens", "centre", "center", "hotel",
]);

function tokenize(s: string): Set<string> {
  const lower = s.toLowerCase();
  // Replace any non-alphanumeric with space, collapse whitespace
  const cleaned = lower.replace(/[^a-z0-9]+/g, " ").trim();
  const toks = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  // Drop stopwords + pure numerics shorter than 4 (keep postcodes etc.)
  const out = new Set<string>();
  for (const t of toks) {
    if (STOPWORDS.has(t)) continue;
    if (/^\d{1,3}$/.test(t)) continue;
    out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Cluster items using IDF-weighted Jaccard ≥ threshold.
 *
 * Tokens that appear in many items (e.g. "park", "road", "electrical",
 * "group", "ltd") have low IDF weight and don't drive clustering by
 * themselves. Discriminating tokens (rare names like "Criterion",
 * "Vabel", "Brondesbury") drive the grouping.
 */
export interface FuzzyGroup<T> {
  /** Best canonical label (longest variant in the group). */
  label: string;
  members: T[];
}

export function fuzzyGroup<T>(
  items: T[],
  getText: (item: T) => string,
  threshold = 0.7
): FuzzyGroup<T>[] {
  const n = items.length;
  if (n === 0) return [];

  const tokens = items.map((i) => tokenize(getText(i)));

  // Compute document frequency per token.
  const df = new Map<string, number>();
  for (const ts of tokens) {
    for (const t of ts) df.set(t, (df.get(t) || 0) + 1);
  }
  // Absolute cutoffs: a token in 4 items is borderline; in 8+ it's noise.
  // For tiny datasets, fall back to fractions.
  const lo = Math.max(5, Math.floor(n * 0.02));
  const hi = Math.max(15, Math.floor(n * 0.06));
  const weight = (t: string): number => {
    const f = df.get(t) || 1;
    if (f >= hi) return 0;
    if (f >= lo) return 0.2;
    return 1;
  };

  // Pre-compute per-item weighted token list (filtering zero-weight tokens).
  const weighted = tokens.map((ts) => {
    const arr: Array<[string, number]> = [];
    for (const t of ts) {
      const w = weight(t);
      if (w > 0) arr.push([t, w]);
    }
    return arr;
  });

  // Overlap coefficient on weighted tokens: |A ∩ B| / min(|A|, |B|).
  // More forgiving than Jaccard when one side has extra noise tokens
  // ("GS8 Construction" vs "GS8 Construction Two") — both still cluster
  // because the discriminating token "gs8" is shared. The discriminating-
  // overlap gate prevents low-quality matches.
  function score(i: number, j: number): number {
    const a = weighted[i];
    const b = weighted[j];
    if (a.length === 0 || b.length === 0) return 0;
    const setB = new Map(b);
    let inter = 0;
    let denomA = 0;
    for (const [t, w] of a) {
      denomA += w;
      if (setB.has(t)) inter += Math.min(w, setB.get(t)!);
    }
    let denomB = 0;
    for (const [, w] of b) denomB += w;
    const minDenom = Math.min(denomA, denomB);
    return minDenom <= 0 ? 0 : inter / minDenom;
  }

  // Connection requires at least one non-common (high-weight) shared token.
  function hasDiscriminatingOverlap(i: number, j: number): boolean {
    const setB = new Set(weighted[j].filter(([, w]) => w === 1).map(([t]) => t));
    for (const [t, w] of weighted[i]) {
      if (w === 1 && setB.has(t)) return true;
    }
    return false;
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    if (weighted[i].length === 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (weighted[j].length === 0) continue;
      if (!hasDiscriminatingOverlap(i, j)) continue;
      if (score(i, j) >= threshold) union(i, j);
    }
  }

  const groups = new Map<number, T[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(items[i]);
  }

  const out: FuzzyGroup<T>[] = [];
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    let label = getText(members[0]);
    for (const m of members) {
      const t = getText(m);
      if (t.length > label.length) label = t;
    }
    out.push({ label, members });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

// silence unused-jaccard warnings; kept for future tuning
void jaccard;

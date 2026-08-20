// Sort every parent TicketLine + every customer-list row into sections A/B/C/D.
//
//   A = parent line whose code starts with VS → Valsir→Geberit swap
//   B = parent line cross-referenced on the customer list (non-VS)
//   C = parent line NOT on the customer list (customer-omitted)
//   D = customer-list row not represented on the parent (customer-only)
//
// Discrepancy semantics: A + B should equal the customer list size. Anything
// else (unit mismatches, composite lines the customer bundled, qty drifts)
// is surfaced, never hidden.

import { extractValsirCode, lookupValsir } from "./mapping";

export type CustomerListRow = {
  idx: number; // 1-based row number on the customer's list
  description: string;
  codeGiven: string | null; // "—" becomes null
  qty: number;
  unit: string;
};

export type ParentLine = {
  id: string;
  description: string;
  productCode: string | null;
  qty: number;
  unit: string;
};

export type ClassifiedRow =
  | {
      section: "A";
      parentLineId: string;
      description: string;
      qty: number;
      unit: string;
      oldCode: string;
      newCode: string;
      flag: "OK" | "VERIFY" | "PRICE_FIX" | "CONFIRM";
      note: string | null;
    }
  | {
      section: "B";
      parentLineId: string;
      description: string;
      qty: number;
      unit: string;
      matchedCustomerIdx: number;
      qtyMismatch?: { customerQty: number };
      unitMismatch?: { customerUnit: string };
    }
  | {
      section: "C";
      parentLineId: string;
      description: string;
      qty: number;
      unit: string;
    }
  | {
      section: "D";
      description: string;
      qty: number;
      unit: string;
      customerCode: string | null;
      customerIdx: number;
    };

export type ClassificationResult = {
  rows: ClassifiedRow[];
  counts: { A: number; B: number; C: number; D: number };
  discrepancies: string[];
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[×*]/g, "x")
    // collapse "22 x 15" ↔ "22x15" so tokenisation matches
    .replace(/(\d)\s*x\s*(\d)/g, "$1x$2")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 .x/°"-]/g, "")
    .trim();
}

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(/[\s/.,-]+/)
      .filter((t) => t.length >= 2),
  );
}

// Asymmetric coverage: how much of A is covered by B.
// Customer descriptions are shorter than parent, so we check
// "customer tokens ⊂ parent tokens" not symmetric overlap.
function coverage(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / ta.size;
}

function splitCodes(code: string): string[] {
  return code
    .split(/[\/,]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function descriptionMatches(
  parentDesc: string,
  parentCode: string | null,
  customerDesc: string,
  customerCode: string | null,
): boolean {
  if (customerCode) {
    const haystack = normalize(`${parentCode ?? ""} ${parentDesc}`);
    for (const sub of splitCodes(customerCode.toLowerCase())) {
      if (haystack.includes(sub)) return true;
    }
  }
  // Customer tokens must be ≥70% covered by parent tokens.
  return coverage(customerDesc, parentDesc) >= 0.7;
}

export function classify(
  parent: ParentLine[],
  customer: CustomerListRow[],
): ClassificationResult {
  const rows: ClassifiedRow[] = [];
  const discrepancies: string[] = [];

  const parentTaken = new Set<string>();
  const customerTaken = new Set<number>();

  // Pass 1: Section A — every parent line with a VS code
  for (const p of parent) {
    const vs =
      (p.productCode && extractValsirCode(p.productCode)) ??
      extractValsirCode(p.description);
    if (!vs) continue;
    const map = lookupValsir(vs);
    if (!map) continue;

    rows.push({
      section: "A",
      parentLineId: p.id,
      description: p.description,
      qty: p.qty,
      unit: p.unit,
      oldCode: map.valsirCode,
      newCode: map.geberitCode,
      flag: map.flag,
      note: map.note,
    });
    parentTaken.add(p.id);

    // mark the corresponding customer row as covered (customer used VS code too)
    const custIdx = customer.findIndex(
      (c) => c.codeGiven === map.valsirCode,
    );
    if (custIdx >= 0) customerTaken.add(customer[custIdx].idx);
  }

  // Pass 2: Section B — parent line vs non-VS customer rows (code-first, then description)
  for (const p of parent) {
    if (parentTaken.has(p.id)) continue;
    let matched: CustomerListRow | null = null;

    // try code match if customer gave one (supports "a / b / c" composites)
    for (const c of customer) {
      if (customerTaken.has(c.idx)) continue;
      if (!c.codeGiven) continue;
      const haystack = normalize(`${p.productCode ?? ""} ${p.description}`);
      const subs = splitCodes(c.codeGiven.toLowerCase());
      if (subs.some((s) => haystack.includes(s))) {
        matched = c;
        break;
      }
    }

    // fall back to description coverage (customer tokens ⊂ parent tokens)
    if (!matched) {
      let bestScore = 0;
      let bestRow: CustomerListRow | null = null;
      for (const c of customer) {
        if (customerTaken.has(c.idx)) continue;
        if (!descriptionMatches(p.description, p.productCode, c.description, c.codeGiven)) continue;
        const score = coverage(c.description, p.description);
        if (score > bestScore) {
          bestScore = score;
          bestRow = c;
        }
      }
      matched = bestRow;
    }

    if (matched) {
      const row: ClassifiedRow = {
        section: "B",
        parentLineId: p.id,
        description: p.description,
        qty: p.qty,
        unit: p.unit,
        matchedCustomerIdx: matched.idx,
      };
      if (matched.qty !== p.qty) {
        row.qtyMismatch = { customerQty: matched.qty };
        discrepancies.push(
          `B qty drift: parent "${p.description}" qty=${p.qty} ${p.unit} vs customer row #${matched.idx} qty=${matched.qty} ${matched.unit}`,
        );
      }
      if (matched.unit.toUpperCase() !== p.unit.toUpperCase()) {
        row.unitMismatch = { customerUnit: matched.unit };
        discrepancies.push(
          `B unit drift: parent "${p.description}" unit=${p.unit} vs customer row #${matched.idx} unit=${matched.unit}`,
        );
      }
      rows.push(row);
      parentTaken.add(p.id);
      customerTaken.add(matched.idx);
    }
  }

  // Pass 3: Section C — unmatched parent lines
  for (const p of parent) {
    if (parentTaken.has(p.id)) continue;
    rows.push({
      section: "C",
      parentLineId: p.id,
      description: p.description,
      qty: p.qty,
      unit: p.unit,
    });
  }

  // Pass 4: Section D — unmatched customer rows
  for (const c of customer) {
    if (customerTaken.has(c.idx)) continue;
    rows.push({
      section: "D",
      description: c.description,
      qty: c.qty,
      unit: c.unit,
      customerCode: c.codeGiven,
      customerIdx: c.idx,
    });
  }

  const counts = {
    A: rows.filter((r) => r.section === "A").length,
    B: rows.filter((r) => r.section === "B").length,
    C: rows.filter((r) => r.section === "C").length,
    D: rows.filter((r) => r.section === "D").length,
  };

  // Sanity check: A + B should equal customer list size
  if (counts.A + counts.B !== customer.length) {
    discrepancies.unshift(
      `Section A (${counts.A}) + Section B (${counts.B}) = ${counts.A + counts.B}, expected ${customer.length} (= customer list size). Review Sections C and D.`,
    );
  }

  return { rows, counts, discrepancies };
}

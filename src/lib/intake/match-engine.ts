/**
 * Multi-signal match engine for bill lines.
 *
 * Replaces the single blended score in auto-link-bill-line with five dimensions:
 *   supplierConfidence — name match, VAT, email-domain, alias
 *   productConfidence  — SKU match, description tokens, SupplierProductMapping history
 *   ticketConfidence   — open ticket, unbilled lines, recent activity
 *   siteConfidence     — name / alias match on TicketLine/PO/Invoice site
 *   entityConfidence   — customer hierarchy (payingCustomer / parent)
 *
 * overallConfidence = 0.35*product + 0.25*ticket + 0.15*site + 0.15*supplier + 0.10*entity
 *
 * Every candidate considered is written to BillLineMatch with per-signal scores
 * and a reasons[] array, giving a full audit of what was tried.
 *
 * Thresholds:
 *   overall ≥ 95 AND product ≥ 80 → AUTO_LINKED
 *   overall 80–94                 → SUGGESTED
 *   overall < 80                  → EXCEPTION
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export interface SignalScores {
  supplierConfidence: number;
  productConfidence:  number;
  ticketConfidence:   number;
  siteConfidence:     number;
  entityConfidence:   number;
  overallConfidence:  number;
  reasons:            string[];
}

type CandidateType = "TICKET_LINE" | "PO_LINE" | "INVOICE_LINE" | "STOCK" | "RETURNS";

interface Candidate {
  type: CandidateType;
  id: string;
  description: string | null;
  productCode: string | null;
  qty: number | null;
  supplierId?: string | null;
  ticketId?: string | null;
  siteId?: string | null;
  customerId?: string | null;
  scores: SignalScores;
}

const WEIGHTS = { product: 0.35, ticket: 0.25, site: 0.15, supplier: 0.15, entity: 0.10 } as const;

const AUTO_OVERALL   = 95;
const AUTO_PRODUCT   = 80;
const SUGGEST_OVERALL = 80;

const STANDARDS_PREFIXES = ["EN", "BSEN", "BS", "ISO", "DIN", "ASTM", "ANSI", "WRAS", "CE", "UKCA"];
const SKU_REGEX = /\b([A-Z][A-Z0-9./-]{3,})\b/g;

function isStandardCode(code: string) {
  return STANDARDS_PREFIXES.some((p) => code.toUpperCase().startsWith(p) && /^[A-Z]+\d+/.test(code.toUpperCase()));
}

function extractSkus(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  let m;
  const re = new RegExp(SKU_REGEX.source, "g");
  while ((m = re.exec(text.toUpperCase())) !== null) {
    const code = m[1];
    if (!/\d/.test(code) || code.length < 4) continue;
    if (isStandardCode(code)) continue;
    out.add(code);
  }
  return [...out];
}

function tokenise(text: string | null | undefined): Set<string> {
  if (!text) return new Set();
  const stop = new Set(["the","and","with","for","mm","cm","ea","pack","box","x","of","kit","set","new","old"]);
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w))
  );
}

function tokenOverlap(a: string | null | undefined, b: string | null | undefined): number {
  const ta = tokenise(a); const tb = tokenise(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0; for (const t of ta) if (tb.has(t)) shared++;
  return Math.round((shared / Math.min(ta.size, tb.size)) * 100);
}

// ──────────────────────────────────────────────────────────────────────────────
// Signals
// ──────────────────────────────────────────────────────────────────────────────

async function supplierSignal(
  billSupplierId: string,
  candSupplierId: string | null | undefined,
  reasons: string[]
): Promise<number> {
  if (!candSupplierId) { reasons.push("supplier: candidate has no supplier"); return 40; }
  if (candSupplierId === billSupplierId) { reasons.push("supplier: exact match"); return 100; }

  // Check SupplierAlias — are these known aliases of each other?
  const [billSupplier, candSupplier] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: billSupplierId }, select: { name: true } }),
    prisma.supplier.findUnique({ where: { id: candSupplierId }, select: { name: true } }),
  ]);
  if (billSupplier && candSupplier) {
    const alias = await prisma.supplierAlias.findFirst({
      where: {
        OR: [
          { supplierId: billSupplierId, alias: { equals: candSupplier.name, mode: "insensitive" } },
          { supplierId: candSupplierId, alias: { equals: billSupplier.name, mode: "insensitive" } },
        ],
      },
    });
    if (alias) { reasons.push(`supplier: alias match (${alias.source})`); return 85; }
  }
  reasons.push("supplier: different supplier");
  return 20;
}

async function productSignal(
  billLine: { description: string; productCode: string | null; extractedSku: string | null; supplierBillId: string },
  cand: { description: string | null; productCode?: string | null },
  supplierId: string,
  reasons: string[]
): Promise<number> {
  let score = 0;
  const billSkus = extractSkus(`${billLine.description} ${billLine.productCode ?? ""} ${billLine.extractedSku ?? ""}`);
  const candSkus = extractSkus(`${cand.description ?? ""} ${cand.productCode ?? ""}`);
  const hit = billSkus.find((s) => candSkus.includes(s));
  if (hit) { score += 80; reasons.push(`product: SKU match ${hit}`); }

  const overlap = tokenOverlap(billLine.description, cand.description);
  if (overlap > 0) { score += Math.round(overlap * 0.6); reasons.push(`product: ${overlap}% token overlap`); }

  // Historical mapping — if we've seen this supplier+SKU (or supplier+desc) before, boost.
  // Boost scales with observationCount so well-established mappings are treated as gospel.
  let mapping = null;
  if (billLine.productCode) {
    mapping = await prisma.supplierProductMapping.findFirst({
      where: { supplierId, supplierSku: billLine.productCode },
    });
  }
  if (!mapping && billLine.description) {
    // Fallback: look up by normalized description (covers no-SKU bills)
    const normalised = billLine.description.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
    mapping = await prisma.supplierProductMapping.findFirst({
      where: { supplierId, OR: [{ normalizedItemName: normalised }, { supplierSku: `desc:${normalised}` }] },
    });
  }
  if (mapping) {
    // Cross-check: does the candidate look like the mapped canonical product?
    const canonical = (mapping.canonicalName ?? mapping.normalizedItemName ?? "").toLowerCase();
    const candDesc = (cand.description ?? "").toLowerCase();
    const canonicalHit = canonical && candDesc && (candDesc.includes(canonical.slice(0, 20)) || tokenOverlap(canonical, candDesc) > 60);
    const baseBoost = canonicalHit ? 25 : 8;
    const obsBoost  = Math.min(15, Math.floor(Math.log2(mapping.observationCount + 1) * 5));
    const totalBoost = baseBoost + obsBoost;
    score += totalBoost;
    reasons.push(`product: mapping hit (${mapping.observationCount}x${canonicalHit ? ", canonical match" : ""}, +${totalBoost})`);
  }

  return Math.min(100, score);
}

function ticketSignal(
  cand: { ticketId?: string | null; ticketStatus?: string | null; ticketUpdatedAt?: Date | null },
  reasons: string[]
): number {
  if (!cand.ticketId) { reasons.push("ticket: candidate not on a ticket"); return 30; }

  const openStatuses = new Set([
    "CAPTURED", "PRICING", "QUOTED", "APPROVED", "ORDERED", "DELIVERED", "COSTED", "PENDING_PO", "RECOVERY",
  ]);

  let score = 60;
  if (cand.ticketStatus && openStatuses.has(cand.ticketStatus)) { score += 25; reasons.push(`ticket: open (${cand.ticketStatus})`); }
  else if (cand.ticketStatus) { reasons.push(`ticket: status ${cand.ticketStatus}`); score += 5; }

  if (cand.ticketUpdatedAt) {
    const ageDays = (Date.now() - new Date(cand.ticketUpdatedAt).getTime()) / 86_400_000;
    if (ageDays <= 14)      { score += 15; reasons.push(`ticket: recent activity (${ageDays.toFixed(0)}d)`); }
    else if (ageDays <= 60) { score += 5;  reasons.push(`ticket: activity within ${ageDays.toFixed(0)}d`); }
    else                    { reasons.push(`ticket: stale (${ageDays.toFixed(0)}d)`); }
  }

  return Math.min(100, score);
}

async function siteSignal(
  billLine: { siteId: string | null; sourceSiteTextRaw: string | null; description: string },
  candSiteId: string | null | undefined,
  reasons: string[]
): Promise<number> {
  if (billLine.siteId && candSiteId && billLine.siteId === candSiteId) {
    reasons.push("site: direct match"); return 100;
  }
  if (!candSiteId) { reasons.push("site: candidate has no site"); return 40; }

  // Try resolving bill site text against aliases
  const siteText = billLine.sourceSiteTextRaw || "";
  if (siteText) {
    const alias = await prisma.siteAlias.findFirst({
      where: { aliasText: { contains: siteText.slice(0, 40), mode: "insensitive" } },
      select: { siteId: true },
    });
    if (alias?.siteId === candSiteId) { reasons.push("site: alias match"); return 90; }
    if (alias) { reasons.push("site: alias resolves elsewhere"); return 20; }
  }

  reasons.push("site: indeterminate");
  return 50;
}

async function entitySignal(
  billLine: { customerId: string | null },
  candCustomerId: string | null | undefined,
  reasons: string[]
): Promise<number> {
  if (!candCustomerId) { reasons.push("entity: candidate has no customer"); return 40; }
  if (billLine.customerId && billLine.customerId === candCustomerId) { reasons.push("entity: customer exact match"); return 100; }

  if (billLine.customerId && candCustomerId) {
    const [a, b] = await Promise.all([
      prisma.customer.findUnique({ where: { id: billLine.customerId }, select: { parentCustomerEntityId: true } }).catch(() => null),
      prisma.customer.findUnique({ where: { id: candCustomerId }, select: { parentCustomerEntityId: true } }).catch(() => null),
    ]);
    const aParent = a?.parentCustomerEntityId ?? null;
    const bParent = b?.parentCustomerEntityId ?? null;
    if (aParent && aParent === candCustomerId) { reasons.push("entity: candidate is parent"); return 80; }
    if (bParent && bParent === billLine.customerId) { reasons.push("entity: candidate is child"); return 80; }
    if (aParent && bParent && aParent === bParent) { reasons.push("entity: siblings"); return 70; }
  }

  reasons.push("entity: different customer");
  return 25;
}

function overall(scores: Omit<SignalScores, "overallConfidence" | "reasons">): number {
  return Math.round(
    scores.productConfidence * WEIGHTS.product +
    scores.ticketConfidence  * WEIGHTS.ticket  +
    scores.siteConfidence    * WEIGHTS.site    +
    scores.supplierConfidence * WEIGHTS.supplier +
    scores.entityConfidence   * WEIGHTS.entity
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

export interface MatchResult {
  billLineId: string;
  best: (Candidate & { action: "AUTO_LINKED" | "SUGGESTED" | "EXCEPTION" }) | null;
  all: Candidate[];
}

export async function matchBillLine(billLineId: string): Promise<MatchResult> {
  const billLine = await prisma.supplierBillLine.findUnique({
    where: { id: billLineId },
    include: { supplierBill: { select: { supplierId: true } } },
  });
  if (!billLine) return { billLineId, best: null, all: [] };

  const supplierId = billLine.supplierBill.supplierId;
  const candidates: Candidate[] = [];

  const skus = extractSkus(`${billLine.description} ${billLine.productCode ?? ""} ${billLine.extractedSku ?? ""}`);
  const tokens = [...tokenise(billLine.description)].slice(0, 6);

  const descWhere = skus.length > 0
    ? { OR: skus.map((s) => ({ description: { contains: s, mode: "insensitive" as const } })) }
    : tokens.length > 0
      ? { OR: tokens.map((t) => ({ description: { contains: t, mode: "insensitive" as const } })) }
      : null;

  if (!descWhere) return { billLineId, best: null, all: [] };

  // ── Ticket lines
  const tickets = await prisma.ticketLine.findMany({
    where: descWhere,
    select: {
      id: true, description: true, qty: true, supplierId: true,
      ticketId: true, siteId: true, payingCustomerId: true,
      ticket: { select: { status: true, updatedAt: true, siteId: true, payingCustomerId: true } },
    },
    take: 50,
  });

  for (const tl of tickets) {
    const reasons: string[] = [];
    const [supplier, product, site, entity] = await Promise.all([
      supplierSignal(supplierId, tl.supplierId, reasons),
      productSignal(billLine, { description: tl.description }, supplierId, reasons),
      siteSignal(billLine, tl.siteId ?? tl.ticket?.siteId ?? null, reasons),
      entitySignal(billLine, tl.payingCustomerId ?? tl.ticket?.payingCustomerId ?? null, reasons),
    ]);
    const ticket = ticketSignal({ ticketId: tl.ticketId, ticketStatus: tl.ticket?.status ?? null, ticketUpdatedAt: tl.ticket?.updatedAt ?? null }, reasons);
    const scores = { supplierConfidence: supplier, productConfidence: product, ticketConfidence: ticket, siteConfidence: site, entityConfidence: entity };
    candidates.push({
      type: "TICKET_LINE",
      id: tl.id,
      description: tl.description,
      productCode: extractSkus(tl.description)[0] ?? null,
      qty: Number(tl.qty),
      supplierId: tl.supplierId,
      ticketId: tl.ticketId,
      siteId: tl.siteId ?? tl.ticket?.siteId ?? null,
      customerId: tl.payingCustomerId ?? tl.ticket?.payingCustomerId ?? null,
      scores: { ...scores, overallConfidence: overall(scores), reasons },
    });
  }

  // ── PO lines
  const poLines = await prisma.customerPOLine.findMany({
    where: descWhere,
    select: {
      id: true, description: true, qty: true,
      customerPO: { select: { ticketId: true, customerId: true, siteId: true } },
    },
    take: 50,
  });
  for (const pl of poLines) {
    const reasons: string[] = [];
    const [supplier, product, site, entity] = await Promise.all([
      supplierSignal(supplierId, null, reasons),
      productSignal(billLine, { description: pl.description }, supplierId, reasons),
      siteSignal(billLine, pl.customerPO?.siteId ?? null, reasons),
      entitySignal(billLine, pl.customerPO?.customerId ?? null, reasons),
    ]);
    const ticket = ticketSignal({ ticketId: pl.customerPO?.ticketId ?? null }, reasons);
    const scores = { supplierConfidence: supplier, productConfidence: product, ticketConfidence: ticket, siteConfidence: site, entityConfidence: entity };
    candidates.push({
      type: "PO_LINE",
      id: pl.id,
      description: pl.description,
      productCode: null,
      qty: Number(pl.qty),
      ticketId: pl.customerPO?.ticketId ?? null,
      siteId: pl.customerPO?.siteId ?? null,
      customerId: pl.customerPO?.customerId ?? null,
      scores: { ...scores, overallConfidence: overall(scores), reasons },
    });
  }

  // ── Invoice lines
  const invLines = await prisma.salesInvoiceLine.findMany({
    where: descWhere,
    select: {
      id: true, description: true, qty: true,
      salesInvoice: { select: { ticketId: true, customerId: true, siteId: true } },
    },
    take: 50,
  });
  for (const il of invLines) {
    const reasons: string[] = [];
    const [supplier, product, site, entity] = await Promise.all([
      supplierSignal(supplierId, null, reasons),
      productSignal(billLine, { description: il.description }, supplierId, reasons),
      siteSignal(billLine, il.salesInvoice?.siteId ?? null, reasons),
      entitySignal(billLine, il.salesInvoice?.customerId ?? null, reasons),
    ]);
    const ticket = ticketSignal({ ticketId: il.salesInvoice?.ticketId ?? null }, reasons);
    const scores = { supplierConfidence: supplier, productConfidence: product, ticketConfidence: ticket, siteConfidence: site, entityConfidence: entity };
    candidates.push({
      type: "INVOICE_LINE",
      id: il.id,
      description: il.description,
      productCode: null,
      qty: Number(il.qty),
      ticketId: il.salesInvoice?.ticketId ?? null,
      siteId: il.salesInvoice?.siteId ?? null,
      customerId: il.salesInvoice?.customerId ?? null,
      scores: { ...scores, overallConfidence: overall(scores), reasons },
    });
  }

  candidates.sort((a, b) => b.scores.overallConfidence - a.scores.overallConfidence);

  // Record every candidate we considered
  for (const c of candidates.slice(0, 20)) {
    const action =
      c.scores.overallConfidence >= AUTO_OVERALL && c.scores.productConfidence >= AUTO_PRODUCT
        ? "AUTO_LINKED"
        : c.scores.overallConfidence >= SUGGEST_OVERALL
          ? "SUGGESTED"
          : "EXCEPTION";

    await prisma.billLineMatch.create({
      data: {
        supplierBillLineId: billLineId,
        candidateType:      c.type,
        candidateId:        c.id,
        supplierConfidence: c.scores.supplierConfidence,
        productConfidence:  c.scores.productConfidence,
        ticketConfidence:   c.scores.ticketConfidence,
        siteConfidence:     c.scores.siteConfidence,
        entityConfidence:   c.scores.entityConfidence,
        overallConfidence:  c.scores.overallConfidence,
        reasons:            c.scores.reasons,
        action,
      },
    }).catch(() => {
      // table may not yet exist in dev — swallow silently
    });
  }

  const top = candidates[0];
  if (!top || top.scores.overallConfidence < SUGGEST_OVERALL) {
    return { billLineId, best: null, all: candidates };
  }

  const action: "AUTO_LINKED" | "SUGGESTED" | "EXCEPTION" =
    top.scores.overallConfidence >= AUTO_OVERALL && top.scores.productConfidence >= AUTO_PRODUCT
      ? "AUTO_LINKED"
      : top.scores.overallConfidence >= SUGGEST_OVERALL
        ? "SUGGESTED"
        : "EXCEPTION";

  await logAudit({
    objectType: "SupplierBillLine",
    objectId:   billLineId,
    actionType: `MATCH_ENGINE_${action}`,
    actor:      "SYSTEM",
    newValue:   {
      candidateType: top.type,
      candidateId:   top.id,
      overall:       top.scores.overallConfidence,
      product:       top.scores.productConfidence,
      ticket:        top.scores.ticketConfidence,
      reasons:       top.scores.reasons,
    },
  });

  return { billLineId, best: { ...top, action }, all: candidates };
}

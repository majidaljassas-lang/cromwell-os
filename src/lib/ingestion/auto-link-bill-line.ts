/**
 * Auto-link a SupplierBillLine to its job context.
 *
 * Source-agnostic — works for Zoho-pulled bills, PDF-parsed bills, manual entry, anything.
 * Searches across TicketLine / CustomerPOLine / SalesInvoiceLine for the strongest match
 * by product code (SKU), then by description tokens.
 *
 * On a high-confidence match it propagates ticketId / siteId / customerId from the matched
 * record back to the bill line, sets allocationStatus, and creates a CostAllocation row
 * (when matched against a TicketLine) so cost flows into the ticket P&L.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit";

const AUTO_THRESHOLD     = 80;
const SUGGEST_THRESHOLD  = 55;
const SKU_REGEX = /\b([A-Z][A-Z0-9./-]{3,})\b/g;

// Common standards/specs that LOOK like SKUs but aren't unique part numbers
const STANDARDS_PREFIXES = ["EN", "BSEN", "BS", "ISO", "DIN", "ASTM", "ANSI", "WRAS", "CE", "UKCA"];
function isStandardCode(code) {
  return STANDARDS_PREFIXES.some(p => code.toUpperCase().startsWith(p) && /^[A-Z]+\d+/.test(code.toUpperCase()));
}

// UOM normalisation — convert any qty/uom pair to a base metres-or-each value
// Default length-per-length for plumbing pipe = 3m unless extracted from description ("3.0M", "5.8M", etc.)
function lengthFromDescription(desc) {
  if (!desc) return null;
  // patterns: "3.0M", "3M", "x 3m", "x3.0m", "3000mm", "5.8m"
  const mm = desc.match(/\b(\d{3,4})\s*MM\b/i);
  if (mm) return Number(mm[1]) / 1000;
  const m = desc.match(/(?:^|[\sx×*])\s*(\d{1,2}(?:\.\d{1,2})?)\s*M\b/i);
  if (m) {
    const v = Number(m[1]);
    if (v >= 0.5 && v <= 12) return v;
  }
  return null;
}

/**
 * Convert a (qty, uom) pair to base units for cross-comparison.
 * - LENGTH/LOT → multiplied by length per piece (default 3m for plumbing)
 * - PACK → unchanged for now (qty stays as packs)
 * - M / MTR → metres
 * - EA → eaches
 *
 * Returns { base: number, baseUnit: "M" | "EA" | "PACK" }.
 */
function normaliseQty(qty, uom, descLen) {
  const u = (uom || "EA").toUpperCase();
  const q = Number(qty || 0);
  if (u === "M" || u === "MTR" || u === "METRE" || u === "METER") return { base: q, baseUnit: "M" };
  if (u === "LENGTH" || u === "LOT") {
    const len = descLen ?? 3;
    return { base: q * len, baseUnit: "M" };
  }
  if (u === "PACK" || u === "BOX") return { base: q, baseUnit: "PACK" };
  return { base: q, baseUnit: "EA" };
}

interface MatchCandidate {
  source: "TICKET_LINE" | "PO_LINE" | "INVOICE_LINE";
  recordId: string;
  ticketId: string | null;
  siteId: string | null;
  customerId: string | null;
  description: string;
  productCode: string | null;
  qty: number | null;
  confidence: number;
  reasons: string[];
}

function extractSkus(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  let m;
  while ((m = SKU_REGEX.exec(text.toUpperCase())) !== null) {
    const code = m[1];
    // Filter out plain words that happen to be all-caps; require at least one digit
    if (!/\d/.test(code) || code.length < 4) continue;
    // Filter out spec/standard codes (EN1057, BS6700, ISO9001, etc.)
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

function tokenOverlapScore(billText: string, candText: string): { score: number; shared: number } {
  const a = tokenise(billText);
  const b = tokenise(candText);
  if (a.size === 0 || b.size === 0) return { score: 0, shared: 0 };
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  // Jaccard-ish: shared / smaller set, capped
  const denom = Math.min(a.size, b.size);
  const ratio = shared / denom;
  return { score: Math.round(ratio * 60), shared };
}

export interface AutoLinkResult {
  billLineId: string;
  matched: boolean;
  candidate: MatchCandidate | null;
  allCandidates: MatchCandidate[];
  action: "AUTO_LINKED" | "SUGGESTED" | "NO_MATCH";
}

export async function autoLinkBillLine(billLineId: string, actor = "SYSTEM"): Promise<AutoLinkResult> {
  const billLine = await prisma.supplierBillLine.findUnique({
    where: { id: billLineId },
    include: { supplierBill: { select: { supplierId: true, billNo: true, billDate: true } } },
  });
  if (!billLine) {
    return { billLineId, matched: false, candidate: null, allCandidates: [], action: "NO_MATCH" };
  }

  const billSkus  = extractSkus(billLine.description + " " + (billLine.productCode ?? ""));
  const billDesc  = billLine.description;

  const candidates: MatchCandidate[] = [];

  // ── A. Hunt across TicketLine ────────────────────────────────────
  const tlWhere: Record<string, unknown> = {};
  if (billSkus.length > 0) {
    tlWhere.OR = billSkus.map((sku) => ({ description: { contains: sku, mode: "insensitive" } }));
  } else {
    // Fall back to first 4 word-tokens, any-of, to keep the candidate set small
    const toks = [...tokenise(billDesc)].slice(0, 4);
    if (toks.length === 0) return { billLineId, matched: false, candidate: null, allCandidates: [], action: "NO_MATCH" };
    tlWhere.OR = toks.map((t) => ({ description: { contains: t, mode: "insensitive" } }));
  }

  const ticketLines = await prisma.ticketLine.findMany({
    where: tlWhere,
    select: {
      id: true, ticketId: true, siteId: true, payingCustomerId: true,
      description: true, qty: true, unit: true, status: true,
      ticket: { select: { id: true, ticketNo: true, title: true, payingCustomerId: true, siteId: true } },
    },
    take: 50,
  });
  // Bill UOM is buried in description for Zoho-pulled lines (no `unit` column).
  // Detect it from description suffix (e.g. "28.50 M", "10 EA", "5 PACK").
  const billUomMatch = (billDesc || "").toUpperCase().match(/\b(\d+(?:\.\d+)?)\s*(M|MTR|METRE|EA|PACK|BOX|LENGTH|LOT)\b/);
  const billUom = billUomMatch?.[2] ?? "EA";
  const billLengthFromDesc = lengthFromDescription(billDesc);
  const billNorm = normaliseQty(billLine.qty, billUom, billLengthFromDesc);

  for (const tl of ticketLines) {
    const reasons: string[] = [];
    let confidence = 0;
    const candSkus = extractSkus(tl.description);
    const skuHit = billSkus.find((s) => candSkus.includes(s));
    if (skuHit) { confidence += 80; reasons.push(`SKU match: ${skuHit}`); }
    const overlap = tokenOverlapScore(billDesc, tl.description);
    confidence += overlap.score;
    if (overlap.shared > 0) reasons.push(`${overlap.shared} desc tokens shared`);
    // UOM-aware qty match — convert both sides to a common base (metres for length, eaches otherwise)
    const tlLengthFromDesc = lengthFromDescription(tl.description);
    const candNorm = normaliseQty(tl.qty, tl.unit, tlLengthFromDesc);
    if (candNorm.baseUnit === billNorm.baseUnit) {
      const ratio = candNorm.base > 0 ? Math.abs(billNorm.base - candNorm.base) / candNorm.base : 1;
      if (ratio < 0.01) { confidence += 10; reasons.push(`qty match (${billNorm.base}${billNorm.baseUnit})`); }
      else if (ratio < 0.1) { confidence += 5; reasons.push(`qty close (bill ${billNorm.base} vs tkt ${candNorm.base} ${billNorm.baseUnit})`); }
      else if (billNorm.base > candNorm.base) {
        // Bill is bigger than ticket needs → MOQ overbuy candidate
        const surplus = billNorm.base - candNorm.base;
        confidence += 4;
        reasons.push(`MOQ overbuy: bill ${billNorm.base}${billNorm.baseUnit} vs ticket ${candNorm.base}${billNorm.baseUnit} (surplus ${surplus.toFixed(2)})`);
      }
    } else {
      reasons.push(`UOM mismatch: bill=${billNorm.baseUnit} ticket=${candNorm.baseUnit}`);
    }
    candidates.push({
      source: "TICKET_LINE",
      recordId: tl.id,
      ticketId: tl.ticketId,
      siteId: tl.siteId ?? tl.ticket?.siteId ?? null,
      customerId: tl.payingCustomerId ?? tl.ticket?.payingCustomerId ?? null,
      description: tl.description,
      productCode: candSkus[0] ?? null,
      qty: Number(tl.qty),
      confidence: Math.min(confidence, 99),
      reasons,
    });
  }

  // ── B. Hunt across SalesInvoiceLine (already-invoiced jobs) ─────
  const invLines = await prisma.salesInvoiceLine.findMany({
    where: tlWhere,
    select: {
      id: true, description: true, qty: true,
      salesInvoice: { select: { id: true, invoiceNo: true, customerId: true, siteId: true, ticketId: true } },
    },
    take: 50,
  });
  for (const il of invLines) {
    const reasons: string[] = [];
    let confidence = 0;
    const candSkus = extractSkus(il.description);
    const skuHit = billSkus.find((s) => candSkus.includes(s));
    if (skuHit) { confidence += 80; reasons.push(`SKU match: ${skuHit}`); }
    const overlap = tokenOverlapScore(billDesc, il.description);
    confidence += overlap.score;
    if (overlap.shared > 0) reasons.push(`${overlap.shared} desc tokens shared`);
    if (Number(il.qty) === Number(billLine.qty)) { confidence += 8; reasons.push("qty match"); }
    candidates.push({
      source: "INVOICE_LINE",
      recordId: il.id,
      ticketId: il.salesInvoice?.ticketId ?? null,
      siteId: il.salesInvoice?.siteId ?? null,
      customerId: il.salesInvoice?.customerId ?? null,
      description: il.description,
      productCode: candSkus[0] ?? null,
      qty: Number(il.qty),
      confidence: Math.min(confidence, 99),
      reasons,
    });
  }

  // ── C. Hunt across CustomerPOLine ───────────────────────────────
  const poLines = await prisma.customerPOLine.findMany({
    where: tlWhere,
    select: {
      id: true, description: true, qty: true,
      customerPO: { select: { id: true, poNo: true, customerId: true, siteId: true, ticketId: true } },
    },
    take: 50,
  });
  for (const pl of poLines) {
    const reasons: string[] = [];
    let confidence = 0;
    const candSkus = extractSkus(pl.description);
    const skuHit = billSkus.find((s) => candSkus.includes(s));
    if (skuHit) { confidence += 75; reasons.push(`SKU match: ${skuHit}`); }
    const overlap = tokenOverlapScore(billDesc, pl.description);
    confidence += overlap.score;
    if (overlap.shared > 0) reasons.push(`${overlap.shared} desc tokens shared`);
    if (Number(pl.qty) === Number(billLine.qty)) { confidence += 6; reasons.push("qty match"); }
    candidates.push({
      source: "PO_LINE",
      recordId: pl.id,
      ticketId: pl.customerPO?.ticketId ?? null,
      siteId: pl.customerPO?.siteId ?? null,
      customerId: pl.customerPO?.customerId ?? null,
      description: pl.description,
      productCode: candSkus[0] ?? null,
      qty: Number(pl.qty),
      confidence: Math.min(confidence, 99),
      reasons,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];

  // No candidate above suggest threshold → mark UNALLOCATED, leave for review
  if (!best || best.confidence < SUGGEST_THRESHOLD) {
    return { billLineId, matched: false, candidate: null, allCandidates: candidates, action: "NO_MATCH" };
  }

  // Always propagate site/customer/ticket on the bill line, even for SUGGESTED — gives the user context
  await prisma.supplierBillLine.update({
    where: { id: billLineId },
    data: {
      ticketId: best.ticketId ?? billLine.ticketId,
      siteId: best.siteId ?? billLine.siteId,
      customerId: best.customerId ?? billLine.customerId,
      allocationStatus: best.confidence >= AUTO_THRESHOLD ? "MATCHED" : "SUGGESTED",
    },
  });

  // If we matched against a TicketLine and confidence is high, also write a CostAllocation
  if (best.source === "TICKET_LINE" && best.confidence >= AUTO_THRESHOLD) {
    const existing = await prisma.costAllocation.findFirst({
      where: { supplierBillLineId: billLineId, ticketLineId: best.recordId },
    });
    if (!existing) {
      await prisma.costAllocation.create({
        data: {
          ticketLineId: best.recordId,
          supplierBillLineId: billLineId,
          supplierId: billLine.supplierBill.supplierId,
          qtyAllocated: billLine.qty,
          unitCost: billLine.unitCost,
          totalCost: billLine.lineTotal,
          allocationStatus: "MATCHED",
          confidenceScore: best.confidence,
          notes: `Auto-linked: ${best.reasons.join(", ")}`,
        },
      });
    }
  }

  await logAudit({
    objectType: "SupplierBillLine",
    objectId: billLineId,
    actionType: best.confidence >= AUTO_THRESHOLD ? "AUTO_LINKED" : "SUGGESTED",
    actor,
    newValue: { source: best.source, recordId: best.recordId, confidence: best.confidence, reasons: best.reasons },
    reason: `Auto-link from bill ${billLine.supplierBill.billNo}`,
  });

  return {
    billLineId,
    matched: true,
    candidate: best,
    allCandidates: candidates.slice(0, 5),
    action: best.confidence >= AUTO_THRESHOLD ? "AUTO_LINKED" : "SUGGESTED",
  };
}

/** Convenience: link every line on a bill. */
export async function autoLinkBill(billId: string, actor = "SYSTEM"): Promise<AutoLinkResult[]> {
  const lines = await prisma.supplierBillLine.findMany({
    where: { supplierBillId: billId },
    select: { id: true },
  });
  const out: AutoLinkResult[] = [];
  for (const l of lines) out.push(await autoLinkBillLine(l.id, actor));
  return out;
}

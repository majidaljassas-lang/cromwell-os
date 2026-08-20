/**
 * Generalised invoice ↔ bill line matcher.
 *
 * Tiers (highest first):
 *   T1 SKU-exact      conf 100 · invoice description has token X (alphanumeric ≥4 chars,
 *                                excluding generic standards like EN1057) that appears
 *                                verbatim on a bill line description in window
 *   T2 Same-job run   conf  95 · ≥3 invoice lines match ≥3 bill lines on the SAME bill
 *                                by (size + product class) — Ashworth/single-supplier pattern
 *   T3 Size+class+qty conf  85 · size + product class + qty equal/within 25%/MOQ multiple
 *   T4 Size+class     conf  60 · size + product class only
 *   else NO_MATCH
 *
 * Pure functions where possible. The compute step is async (DB query).
 */

import { prisma } from "@/lib/prisma";

export const WINDOW_DAYS_DEFAULT = 60;

// Generic standards that appear on lots of bill descriptions and must NOT be
// treated as a unique SKU. Add more as we discover them.
const GENERIC_STANDARD_TOKENS = new Set<string>([
  "EN1057",   // copper tube standard
  "EN10",
  "BS6700",
  "BS5440",
  "BS7671",
  "BS",
  "ISO",
  "WRAS",
]);

const SKU_RX = /\b[A-Z]{1,3}\d{3,6}\b|\b[A-Z]+\d{2,}[A-Z]*\b/g;
const SIZE_RX = /\b(\d{1,3})\s*mm\b/gi;

const PRODUCT_CLASSES: Array<{ cls: string; needles: string[] }> = [
  { cls: "COPPER_TUBE",   needles: ["copper tube","copper pipe"] },
  { cls: "PRESSFIT",      needles: ["pressfit","press fit","press-fit"] },
  { cls: "PIPE_CUTTER",   needles: ["pipe cutter","tube cutter"] },
  { cls: "BALL_VALVE",    needles: ["ball valve"] },
  { cls: "ELBOW",         needles: ["elbow","bend"] },
  { cls: "TEE",           needles: ["equal tee"," tee "," tee."] },
  { cls: "REDUCER",       needles: ["reducer","reducing"] },
  { cls: "COUPLER",       needles: ["coupler","coupling","union"] },
  { cls: "FITTING",       needles: ["fitting","adaptor","adapter"] },
  { cls: "VALVE_OTHER",   needles: ["valve","stop cock","gate valve","check valve"] },
  { cls: "CLIP_BRACKET",  needles: ["clip","bracket","clamp","band"] },
  { cls: "INSULATION",    needles: ["lagging","insulation","armaflex"] },
  { cls: "SOIL",          needles: ["soil pipe","ensign","agilium"] },
  { cls: "TMV",           needles: ["thermostatic mixing","tmv"] },
];

export function classify(desc: string | null | undefined): string | null {
  const d = (desc || "").toLowerCase();
  if (!d) return null;
  for (const p of PRODUCT_CLASSES) if (p.needles.some(n => d.includes(n))) return p.cls;
  return null;
}

export function extractSKUs(desc: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!desc) return out;
  for (const m of (desc.match(SKU_RX) || [])) {
    const tok = m.toUpperCase();
    if (tok.length < 4) continue;
    if (GENERIC_STANDARD_TOKENS.has(tok)) continue;
    // strip strict generic patterns: pure "BS" + digits, "EN" + digits where length is short
    if (/^(BS|EN|ISO)\d{1,5}$/.test(tok)) continue;
    out.add(tok);
  }
  return out;
}

export function extractSizes(desc: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!desc) return out;
  const lower = desc.toLowerCase();
  let m: RegExpExecArray | null;
  const rx = /\b(\d{1,3})\s*mm\b/g;
  while ((m = rx.exec(lower)) !== null) out.add(m[1]);
  return out;
}

export type MatchTier = "T1" | "T2" | "T3" | "T4";
export type ClearStatus = "CLEARED" | "SUGGESTED" | "NO_MATCH";

export interface MatchCandidate {
  billLineId: string;
  billNo: string | null;
  vendor: string | null;
  billDate: Date | null;
  cfSite: string | null;
  customerName: string | null;
  description: string;
  qty: number;
  rate: number;
  itemTotal: number;
  tier: MatchTier;
  confidence: number;
  reason: string;
}

export interface InvoiceLineMatchResult {
  invoiceLineId: string;
  status: ClearStatus;
  best: MatchCandidate | null;
  alternates: MatchCandidate[]; // up to 4 other candidates ranked behind best
}

interface BillLineRow {
  id: string;
  description: string;
  quantity: unknown;
  rate: unknown;
  itemTotal: unknown;
  cfSite: string | null;
  customerName: string | null;
  bill: {
    zohoNumber: string | null;
    vendorName: string | null;
    billDate: Date | null;
  };
}

/**
 * Compute matches for every line of one invoice.
 * Loads only the bill lines in the date window, filters in JS.
 */
export async function matchInvoice(invoiceId: string, opts: { windowDays?: number } = {}): Promise<{
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string | null;
  invoiceDate: Date | null;
  total: number;
  lines: Array<{
    invoiceLineId: string;
    lineNumber: number;
    description: string;
    quantity: number;
    rate: number;
    itemTotal: number;
    cfSite: string | null;
    match: InvoiceLineMatchResult;
  }>;
  summary: {
    totalLines: number;
    cleared: number;
    suggested: number;
    noMatch: number;
    clearedValue: number;
    suggestedValue: number;
    noMatchValue: number;
  };
}> {
  const windowDays = opts.windowDays ?? WINDOW_DAYS_DEFAULT;
  const invoice = await prisma.zohoImportedInvoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { orderBy: { lineNumber: "asc" } } },
  });
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const invDate = invoice.invoiceDate ?? new Date();
  const lo = new Date(invDate); lo.setDate(lo.getDate() - windowDays);
  const hi = new Date(invDate); hi.setDate(hi.getDate() + windowDays);

  const billLines = await prisma.zohoImportedBillLine.findMany({
    where: { bill: { billDate: { gte: lo, lte: hi } } },
    include: { bill: { select: { zohoNumber: true, vendorName: true, billDate: true } } },
  });

  // Pre-process bills
  const billRecords = billLines.map((bl): BillLineRow & { skus: Set<string>; sizes: Set<string>; cls: string | null; descLower: string } => ({
    id: bl.id,
    description: bl.itemDesc || bl.itemName || "",
    quantity: bl.quantity, rate: bl.rate, itemTotal: bl.itemTotal,
    cfSite: bl.cfSite, customerName: bl.customerName,
    bill: { zohoNumber: bl.bill.zohoNumber, vendorName: bl.bill.vendorName, billDate: bl.bill.billDate },
    skus: extractSKUs(bl.itemDesc || bl.itemName),
    sizes: extractSizes(bl.itemDesc || bl.itemName),
    cls: classify(bl.itemDesc || bl.itemName),
    descLower: ((bl.itemDesc || bl.itemName) || "").toLowerCase(),
  }));

  const billBySku = new Map<string, typeof billRecords>();
  const billBySizeCls = new Map<string, typeof billRecords>();
  for (const br of billRecords) {
    for (const s of br.skus) {
      if (!billBySku.has(s)) billBySku.set(s, []);
      billBySku.get(s)!.push(br);
    }
    if (br.cls) {
      for (const sz of br.sizes) {
        const k = `${sz}|${br.cls}`;
        if (!billBySizeCls.has(k)) billBySizeCls.set(k, []);
        billBySizeCls.get(k)!.push(br);
      }
    }
  }

  // Detect same-job bill (≥3 invoice lines mapping to same bill by size+cls)
  const billHits = new Map<string, number>();
  for (const il of invoice.lines) {
    const ilCls = classify(il.itemDesc || il.itemName);
    const ilSizes = extractSizes(il.itemDesc || il.itemName);
    if (!ilCls) continue;
    for (const sz of ilSizes) {
      const cands = billBySizeCls.get(`${sz}|${ilCls}`) || [];
      const seen = new Set<string>();
      for (const c of cands) {
        const key = c.bill.zohoNumber ?? "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        billHits.set(key, (billHits.get(key) || 0) + 1);
      }
    }
  }
  const sameJobBills = new Set([...billHits.entries()].filter(([, n]) => n >= 3).map(([k]) => k));

  function buildCand(br: typeof billRecords[number], tier: MatchTier, confidence: number, reason: string): MatchCandidate {
    return {
      billLineId: br.id, billNo: br.bill.zohoNumber, vendor: br.bill.vendorName, billDate: br.bill.billDate,
      cfSite: br.cfSite, customerName: br.customerName,
      description: br.description, qty: Number(br.quantity ?? 0), rate: Number(br.rate ?? 0),
      itemTotal: Number(br.itemTotal ?? 0),
      tier, confidence, reason,
    };
  }

  const summary = { totalLines: 0, cleared: 0, suggested: 0, noMatch: 0, clearedValue: 0, suggestedValue: 0, noMatchValue: 0 };
  const linesOut = [];

  for (const il of invoice.lines) {
    const ilDesc = il.itemDesc || il.itemName || "";
    const ilSkus = extractSKUs(ilDesc);
    const ilCls = classify(ilDesc);
    const ilSizes = extractSizes(ilDesc);
    const ilQty = Number(il.quantity ?? 0);
    const ilTotal = Number(il.itemTotal ?? 0);

    const candidates: MatchCandidate[] = [];

    // T1: SKU exact
    for (const sku of ilSkus) {
      const cands = billBySku.get(sku) || [];
      for (const c of cands) {
        candidates.push(buildCand(c, "T1", 100, `SKU ${sku} exact match · ${c.bill.vendorName} ${c.bill.zohoNumber}`));
      }
    }

    // T2: same-job bill
    if (ilCls && sameJobBills.size > 0) {
      for (const sz of ilSizes) {
        const cands = billBySizeCls.get(`${sz}|${ilCls}`) || [];
        for (const c of cands) {
          if (c.bill.zohoNumber && sameJobBills.has(c.bill.zohoNumber)) {
            candidates.push(buildCand(c, "T2", 95, `Same-job bill ${c.bill.vendorName} ${c.bill.zohoNumber} · size+class match`));
          }
        }
      }
    }

    // T3: size+class+qty
    if (ilCls) {
      for (const sz of ilSizes) {
        const cands = billBySizeCls.get(`${sz}|${ilCls}`) || [];
        for (const c of cands) {
          const cQty = Number(c.quantity ?? 0);
          let qtyOk = false;
          if (cQty === ilQty) qtyOk = true;
          else if (cQty > 0 && ilQty > 0 && Math.abs(cQty - ilQty) / Math.max(cQty, ilQty) <= 0.25) qtyOk = true;
          else if (cQty > 0 && ilQty > 0 && cQty % ilQty === 0) qtyOk = true; // MOQ overage
          if (qtyOk) {
            candidates.push(buildCand(c, "T3", 85, `Size+class+qty match · ${c.bill.vendorName} ${c.bill.zohoNumber}`));
          }
        }
      }
    }

    // T4: size+class only
    if (ilCls) {
      for (const sz of ilSizes) {
        const cands = billBySizeCls.get(`${sz}|${ilCls}`) || [];
        for (const c of cands) {
          candidates.push(buildCand(c, "T4", 60, `Size+class only · ${c.bill.vendorName} ${c.bill.zohoNumber}`));
        }
      }
    }

    // Dedupe by billLineId, keep highest tier per
    const dedup = new Map<string, MatchCandidate>();
    for (const c of candidates) {
      const ex = dedup.get(c.billLineId);
      if (!ex || c.confidence > ex.confidence) dedup.set(c.billLineId, c);
    }
    const ranked = [...dedup.values()].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // tiebreak: closer date to invoice
      const da = a.billDate ? Math.abs(invDate.getTime() - a.billDate.getTime()) : Number.MAX_SAFE_INTEGER;
      const db = b.billDate ? Math.abs(invDate.getTime() - b.billDate.getTime()) : Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    let status: ClearStatus = "NO_MATCH";
    if (ranked.length > 0) {
      const top = ranked[0];
      if (top.tier === "T1" || top.tier === "T2") status = "CLEARED";
      else status = "SUGGESTED";
    }

    summary.totalLines++;
    if (status === "CLEARED")        { summary.cleared++;   summary.clearedValue   += ilTotal; }
    else if (status === "SUGGESTED") { summary.suggested++; summary.suggestedValue += ilTotal; }
    else                             { summary.noMatch++;   summary.noMatchValue   += ilTotal; }

    linesOut.push({
      invoiceLineId: il.id,
      lineNumber: il.lineNumber,
      description: ilDesc,
      quantity: ilQty,
      rate: Number(il.itemPrice ?? 0),
      itemTotal: ilTotal,
      cfSite: il.cfSite,
      match: { invoiceLineId: il.id, status, best: ranked[0] ?? null, alternates: ranked.slice(1, 5) },
    });
  }

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.zohoNumber,
    customerName: invoice.customerName,
    invoiceDate: invoice.invoiceDate,
    total: Number(invoice.total ?? 0),
    lines: linesOut,
    summary,
  };
}

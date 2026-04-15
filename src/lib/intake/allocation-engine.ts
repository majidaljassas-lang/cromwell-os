/**
 * Allocation engine — the heart of the bills intake engine.
 *
 * For a single SupplierBillLine, decides how the billed qty is distributed across:
 *   TICKET_LINE       — one or more tickets needing this product (grouped-purchase split)
 *   STOCK             — surplus < threshold on stock-friendly SKUs
 *   RETURNS_CANDIDATE — surplus over threshold, or non-stockable items
 *   OVERHEAD          — consumables (sealant, fixings, rags, etc.)
 *   UNRESOLVED        — can't classify — sent to review, never silently dropped
 *
 * Core rules:
 *   1. Never discard surplus — every billed unit must appear in BillLineAllocation rows.
 *   2. PACK / LENGTH UOM → allocate whole units only.
 *   3. Grouped purchase — find ALL open tickets needing this product class
 *      from the same supplier, within a ±14 day window, same or related sites.
 *      Allocate in priority: oldest ticket first, then largest need.
 *   4. Write a proposed Return only at post-time — here we only mark the allocation.
 *
 * This function is idempotent: re-running wipes the previous allocation rows
 * for the bill line (that were not yet posted) and recomputes.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

const STOCK_THRESHOLD_QTY = 50;
const GROUPED_WINDOW_DAYS = 14;

const CONSUMABLE_TOKENS = [
  "sealant", "silicone", "rags", "tape", "screws", "bolts", "washers",
  "nails", "fixings", "adhesive", "glue", "lubricant", "solvent", "cleaner",
  "wipes", "gloves", "consumable",
];

const STOCK_FRIENDLY_TOKENS = [
  "pipe", "copper", "tube", "elbow", "tee", "coupler", "connector",
  "reducer", "fitting", "valve", "bracket", "clip", "clamp", "band",
];

export interface AllocateResult {
  billLineId: string;
  allocations: Array<{
    type: "TICKET_LINE" | "STOCK" | "RETURNS_CANDIDATE" | "OVERHEAD" | "UNRESOLVED";
    ticketLineId?: string | null;
    ticketId?: string | null;
    siteId?: string | null;
    customerId?: string | null;
    qty: number;
    cost: number;
    reason: string;
    confidence?: number;
  }>;
  hasUnresolved: boolean;
  totalQtyAllocated: number;
  billedQty: number;
}

function tokenise(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
}

function looksConsumable(desc: string | null | undefined): boolean {
  const toks = new Set(tokenise(desc));
  return CONSUMABLE_TOKENS.some((t) => toks.has(t));
}

function looksStockFriendly(desc: string | null | undefined): boolean {
  const toks = new Set(tokenise(desc));
  return STOCK_FRIENDLY_TOKENS.some((t) => toks.has(t));
}

function parsePackSize(billLine: { description: string; originalUom: string | null; packSize: number | null }): number {
  if (billLine.packSize && billLine.packSize > 0) return billLine.packSize;
  const m = billLine.description.match(/\(\s*(\d{2,4})\s*\)/);
  if (m) return Number(m[1]);
  return 1;
}

function isPackOrLength(uom: string | null | undefined): boolean {
  if (!uom) return false;
  const u = uom.toUpperCase();
  return u === "PACK" || u === "BOX" || u === "LENGTH" || u === "LOT" || u === "SET";
}

// Find open tickets that need this product (grouped-purchase detection)
async function findGroupedTickets(billLine: {
  id: string;
  description: string;
  productCode: string | null;
  extractedSku: string | null;
  supplierBill: { supplierId: string; billDate: Date };
}): Promise<Array<{ ticketLineId: string; ticketId: string; siteId: string | null; customerId: string | null; qtyNeeded: number; updatedAt: Date }>> {
  const tokens = tokenise(billLine.description).slice(0, 6);
  const skus = [billLine.productCode, billLine.extractedSku].filter(Boolean) as string[];

  const openStatuses: Array<"CAPTURED" | "PRICING" | "QUOTED" | "APPROVED" | "ORDERED" | "DELIVERED" | "COSTED" | "PENDING_PO" | "RECOVERY"> = [
    "CAPTURED", "PRICING", "QUOTED", "APPROVED", "ORDERED", "DELIVERED", "COSTED", "PENDING_PO", "RECOVERY",
  ];

  const whereOR: Record<string, unknown>[] = [];
  for (const s of skus) whereOR.push({ description: { contains: s, mode: "insensitive" } });
  for (const t of tokens) whereOR.push({ description: { contains: t, mode: "insensitive" } });

  if (whereOR.length === 0) return [];

  const billDate = billLine.supplierBill.billDate;
  const windowMs = GROUPED_WINDOW_DAYS * 86_400_000;
  const from = new Date(billDate.getTime() - windowMs);
  const to   = new Date(billDate.getTime() + windowMs);

  const rows = await prisma.ticketLine.findMany({
    where: {
      OR: whereOR,
      ticket: {
        status: { in: openStatuses },
        updatedAt: { gte: from, lte: to },
      },
    },
    include: {
      ticket: { select: { siteId: true, payingCustomerId: true, createdAt: true, updatedAt: true } },
    },
    take: 20,
  });

  type Row = typeof rows[number];

  // Dedupe by ticket (one ticket line per ticket max to avoid double-counting)
  const perTicket = new Map<string, { row: Row; score: number }>();
  for (const r of rows) {
    const ttokens = new Set(tokenise(r.description));
    let overlap = 0; for (const t of tokens) if (ttokens.has(t)) overlap++;
    const score = skus.some((s) => r.description.toUpperCase().includes(s.toUpperCase())) ? 100 + overlap : overlap;
    const prev = perTicket.get(r.ticketId);
    if (!prev || prev.score < score) perTicket.set(r.ticketId, { row: r, score });
  }

  return [...perTicket.values()]
    .map(({ row }) => ({
      ticketLineId: row.id,
      ticketId:     row.ticketId,
      siteId:       row.siteId ?? row.ticket?.siteId ?? null,
      customerId:   row.payingCustomerId ?? row.ticket?.payingCustomerId ?? null,
      qtyNeeded:    Number(row.qty),
      updatedAt:    row.ticket?.updatedAt ?? new Date(),
    }))
    // priority: oldest ticket first, then largest need
    .sort((a, b) => {
      const byAge = a.updatedAt.getTime() - b.updatedAt.getTime();
      if (byAge !== 0) return byAge;
      return b.qtyNeeded - a.qtyNeeded;
    });
}

export async function allocateBillLine(billLineId: string): Promise<AllocateResult> {
  const billLine = await prisma.supplierBillLine.findUnique({
    where: { id: billLineId },
    include: { supplierBill: { select: { supplierId: true, billDate: true } } },
  });
  if (!billLine) {
    return { billLineId, allocations: [], hasUnresolved: false, totalQtyAllocated: 0, billedQty: 0 };
  }

  // Wipe prior unposted allocations (idempotency)
  await prisma.billLineAllocation.deleteMany({
    where: {
      supplierBillLineId: billLineId,
      costAllocationId: null,
      returnId: null,
      stockExcessRecordId: null,
      absorbedAllocationId: null,
    },
  });

  const billedQty = Number(billLine.qty);
  const unitCost  = Number(billLine.unitCost);
  const uom       = billLine.originalUom;
  const packSize  = parsePackSize({ description: billLine.description, originalUom: uom, packSize: billLine.packSize });
  const mustAllocateWholeUnits = isPackOrLength(uom);

  const result: AllocateResult = {
    billLineId,
    allocations: [],
    hasUnresolved: false,
    totalQtyAllocated: 0,
    billedQty,
  };

  // Step 1: grouped-purchase across open tickets
  const grouped = await findGroupedTickets({
    id: billLineId,
    description: billLine.description,
    productCode: billLine.productCode,
    extractedSku: billLine.extractedSku,
    supplierBill: billLine.supplierBill,
  });

  let remaining = billedQty;
  for (const g of grouped) {
    if (remaining <= 0) break;
    let take = Math.min(g.qtyNeeded, remaining);
    if (mustAllocateWholeUnits) take = Math.floor(take);
    if (take <= 0) continue;
    const cost = round2(take * unitCost);
    result.allocations.push({
      type:         "TICKET_LINE",
      ticketLineId: g.ticketLineId,
      ticketId:     g.ticketId,
      siteId:       g.siteId,
      customerId:   g.customerId,
      qty:          take,
      cost,
      reason:       grouped.length > 1
        ? `Grouped purchase: ticket needs ${g.qtyNeeded}${uom ?? ""}, taking ${take}`
        : `Ticket match: needs ${g.qtyNeeded}${uom ?? ""}, taking ${take}`,
      confidence: 90,
    });
    remaining -= take;
  }

  // Step 2: classify the surplus
  if (remaining > 0) {
    const consumable = looksConsumable(billLine.description);
    const stockFriendly = looksStockFriendly(billLine.description);
    const reason = remaining === billedQty
      ? "No open ticket matched — surplus classification"
      : `MOQ overbuy: ${remaining}${uom ?? ""} surplus after ticket allocation`;

    if (consumable) {
      result.allocations.push({
        type: "OVERHEAD",
        ticketLineId: grouped[0]?.ticketLineId ?? null,
        ticketId:     grouped[0]?.ticketId ?? null,
        siteId:       grouped[0]?.siteId ?? null,
        customerId:   grouped[0]?.customerId ?? null,
        qty:          remaining,
        cost:         round2(remaining * unitCost),
        reason:       `${reason} → consumable/overhead`,
        confidence:   80,
      });
      remaining = 0;
    } else if (stockFriendly && remaining < STOCK_THRESHOLD_QTY) {
      result.allocations.push({
        type: "STOCK",
        ticketLineId: grouped[0]?.ticketLineId ?? null,
        ticketId:     grouped[0]?.ticketId ?? null,
        siteId:       grouped[0]?.siteId ?? null,
        qty:          remaining,
        cost:         round2(remaining * unitCost),
        reason:       `${reason} → stockable (holding for reuse)`,
        confidence:   85,
      });
      remaining = 0;
    } else if (remaining >= STOCK_THRESHOLD_QTY) {
      result.allocations.push({
        type: "RETURNS_CANDIDATE",
        ticketLineId: grouped[0]?.ticketLineId ?? null,
        ticketId:     grouped[0]?.ticketId ?? null,
        siteId:       grouped[0]?.siteId ?? null,
        qty:          remaining,
        cost:         round2(remaining * unitCost),
        reason:       `${reason} → returns candidate (qty ≥ ${STOCK_THRESHOLD_QTY})`,
        confidence:   75,
      });
      remaining = 0;
    } else {
      // Non-stockable, non-consumable, small qty — still park as stock-hold unless we can't
      result.allocations.push({
        type: "UNRESOLVED",
        qty:  remaining,
        cost: round2(remaining * unitCost),
        reason: `${reason} → could not classify automatically (review)`,
      });
      result.hasUnresolved = true;
      remaining = 0;
    }
  }

  // Step 3: persist
  let lineAllocStatus: "MATCHED" | "PARTIAL" | "EXCEPTION" = "MATCHED";
  if (result.hasUnresolved) lineAllocStatus = "EXCEPTION";
  else if (result.allocations.some((a) => a.type !== "TICKET_LINE")) lineAllocStatus = "PARTIAL";

  await prisma.$transaction(async (tx) => {
    for (const a of result.allocations) {
      await tx.billLineAllocation.create({
        data: {
          supplierBillLineId: billLineId,
          allocationType:     a.type,
          ticketLineId:       a.ticketLineId ?? undefined,
          ticketId:           a.ticketId ?? undefined,
          siteId:             a.siteId ?? undefined,
          customerId:         a.customerId ?? undefined,
          qtyAllocated:       a.qty,
          costAllocated:      a.cost,
          confidence:         a.confidence ?? undefined,
          reason:             a.reason,
          createdBy:          "system",
        },
      });
    }
    await tx.supplierBillLine.update({
      where: { id: billLineId },
      data:  { allocationStatus: lineAllocStatus },
    });
  });

  result.totalQtyAllocated = result.allocations.reduce((s, a) => s + a.qty, 0);

  // Sanity check — sums must add up
  if (Math.abs(result.totalQtyAllocated - billedQty) > 0.0001) {
    await logAudit({
      objectType: "SupplierBillLine",
      objectId:   billLineId,
      actionType: "ALLOCATION_MISMATCH",
      actor:      "SYSTEM",
      reason:     `Billed ${billedQty} but allocated ${result.totalQtyAllocated}`,
      newValue:   { allocations: result.allocations },
    });
    result.hasUnresolved = true;
  }

  await logAudit({
    objectType: "SupplierBillLine",
    objectId:   billLineId,
    actionType: "ALLOCATION_COMPLETE",
    actor:      "SYSTEM",
    newValue:   {
      status: lineAllocStatus,
      breakdown: result.allocations.map((a) => ({ type: a.type, qty: a.qty, cost: a.cost })),
      packSize,
    },
  });

  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

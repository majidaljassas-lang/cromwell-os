/**
 * 3-way match engine — reconciles SupplierBill against ProcurementOrder
 * (what we committed to buy) and LogisticsEvent (what actually arrived).
 *
 * This closes the Kartell / CP2489019 gap: a supplier invoice for a
 * delivery that never landed must be caught automatically, not after
 * it's paid.
 *
 * Chain (per the live trading spine):
 *   SupplierBill
 *     └─ SupplierBillLine
 *         └─ CostAllocation          (the PO bridge)
 *             └─ ProcurementOrderLine
 *                 └─ ProcurementOrder
 *                     └─ Ticket
 *                         └─ LogisticsEvent  (delivery signal)
 *
 * Status matrix (see BillMatchStatus enum for definitions):
 *   PO linked + DELIVERED + variance ≤ 2 %     → MATCHED
 *   PO linked + DELIVERED + variance > 2 %     → VARIANCE
 *   PO linked + BYPASSED / NOT_ARRIVED         → DISPUTE (+ Task + email draft)
 *   PO linked + no delivery signal             → AWAITING_DELIVERY  (pre-Phase-3 safety)
 *   PO linked, mixed delivered/disputed        → PARTIAL
 *   No PO linkage at all                       → ORPHAN_BILL
 *
 * AWAITING_BILL is written by Phase 4 (on-delivery invoice trigger) when a
 * delivery has landed but no SupplierBill exists yet — not by this module.
 */

import { prisma } from "@/lib/prisma";
import type { BillMatchStatus, Prisma } from "@/generated/prisma";

const VARIANCE_THRESHOLD = 0.02; // 2 %

type DeliverySignal = "DELIVERED" | "BYPASSED" | "NOT_ARRIVED" | "UNKNOWN";

export interface ThreeWayMatchOutcome {
  billId: string;
  billNo: string;
  supplierName: string;
  matchStatus: BillMatchStatus;
  matchedAt: Date;
  expectedTotal: number | null;
  billedTotal: number;
  varianceAmount: number | null;
  variancePct: number | null;
  linkedPOCount: number;
  disputeTaskId?: string;
  notes: string;
}

export interface RunThreeWayMatchResult {
  ok: boolean;
  scanned: number;
  matched: number;
  disputed: number;
  variance: number;
  awaitingDelivery: number;
  awaitingBill: number;
  orphanBill: number;
  partial: number;
  failed: number;
  outcomes: ThreeWayMatchOutcome[];
  errors: Array<{ billId: string; error: string }>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Iterate over all candidate bills (matchStatus NULL, AWAITING_DELIVERY,
 * or AWAITING_BILL) and apply 3-way match. Terminal statuses (MATCHED,
 * DISPUTE, VARIANCE, ORPHAN_BILL, PARTIAL) are left untouched — operators
 * clear those explicitly via the dispute or variance workflow.
 */
export async function runThreeWayMatch(
  opts: { limit?: number } = {}
): Promise<RunThreeWayMatchResult> {
  const limit = Math.min(opts.limit ?? 100, 500);

  const candidates = await prisma.supplierBill.findMany({
    where: {
      OR: [
        { matchStatus: null },
        { matchStatus: "AWAITING_DELIVERY" },
        { matchStatus: "AWAITING_BILL" },
      ],
    },
    select: { id: true },
    orderBy: { billDate: "asc" },
    take: limit,
  });

  const result: RunThreeWayMatchResult = {
    ok: true,
    scanned: 0,
    matched: 0,
    disputed: 0,
    variance: 0,
    awaitingDelivery: 0,
    awaitingBill: 0,
    orphanBill: 0,
    partial: 0,
    failed: 0,
    outcomes: [],
    errors: [],
  };

  for (const { id } of candidates) {
    try {
      const outcome = await threeWayMatchBill(id);
      result.scanned += 1;
      result.outcomes.push(outcome);
      bumpCounter(result, outcome.matchStatus);
    } catch (err) {
      result.failed += 1;
      result.ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ billId: id, error: msg });
      console.error(`[three-way-match] bill ${id} failed:`, err);
    }
  }

  return result;
}

/**
 * Match a single SupplierBill. Idempotent — re-running on a MATCHED bill
 * is harmless (the match is recomputed and nothing user-visible changes
 * unless the underlying PO / delivery / bill amounts have moved).
 */
export async function threeWayMatchBill(
  billId: string
): Promise<ThreeWayMatchOutcome> {
  const bill = await prisma.supplierBill.findUnique({
    where: { id: billId },
    include: {
      supplier: { select: { id: true, name: true, email: true } },
      lines: {
        select: {
          id: true,
          lineTotal: true,
          amountExVat: true,
          costAllocations: {
            select: {
              totalCost: true,
              procurementLine: {
                select: {
                  id: true,
                  lineTotal: true,
                  procurementOrder: {
                    select: {
                      id: true,
                      poNo: true,
                      ticketId: true,
                      totalCostExpected: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!bill) throw new Error(`SupplierBill ${billId} not found`);

  const billedTotal = Number(bill.amountExVat ?? bill.totalCost);
  const billHeader = {
    billId: bill.id,
    billNo: bill.billNo,
    supplierName: bill.supplier.name,
  };

  // ── Collect linked POs (via CostAllocation → ProcurementOrderLine) ──
  const linkedPOs = new Map<
    string,
    { poNo: string; ticketId: string; expectedTotal: number }
  >();

  for (const line of bill.lines) {
    for (const alloc of line.costAllocations) {
      const po = alloc.procurementLine?.procurementOrder;
      if (!po) continue;
      const existing = linkedPOs.get(po.id);
      const lineExpected = alloc.procurementLine?.lineTotal
        ? Number(alloc.procurementLine.lineTotal)
        : 0;
      if (existing) {
        existing.expectedTotal += lineExpected;
      } else {
        linkedPOs.set(po.id, {
          poNo: po.poNo,
          ticketId: po.ticketId,
          expectedTotal: lineExpected,
        });
      }
    }
  }

  // ── ORPHAN — no PO linkage at all ──
  if (linkedPOs.size === 0) {
    return writeOutcome(bill.id, {
      ...billHeader,
      matchStatus: "ORPHAN_BILL",
      expectedTotal: null,
      billedTotal,
      varianceAmount: null,
      variancePct: null,
      linkedPOCount: 0,
      notes:
        "Bill has no CostAllocation → ProcurementOrder chain. Flagged for manual review.",
    });
  }

  // ── Probe delivery for each linked PO ──
  const deliveryByPO = new Map<string, DeliverySignal>();
  const failedDeliveries: Array<{ poNo: string; signal: DeliverySignal }> = [];
  const awaitingPOs: string[] = [];
  const deliveredPOs: string[] = [];

  for (const [poId, po] of linkedPOs) {
    const signal = await probeDelivery(po.ticketId);
    deliveryByPO.set(poId, signal);
    if (signal === "BYPASSED" || signal === "NOT_ARRIVED") {
      failedDeliveries.push({ poNo: po.poNo, signal });
    } else if (signal === "UNKNOWN") {
      awaitingPOs.push(po.poNo);
    } else {
      deliveredPOs.push(po.poNo);
    }
  }

  const hasFailed = failedDeliveries.length > 0;
  const hasAwaiting = awaitingPOs.length > 0;
  const hasDelivered = deliveredPOs.length > 0;

  // ── DISPUTE (at least one PO explicitly failed to deliver) ──
  if (hasFailed) {
    // PARTIAL if some POs are confirmed delivered, some failed
    const matchStatus: BillMatchStatus =
      hasDelivered && !hasAwaiting ? "PARTIAL" : "DISPUTE";

    const firstLinkedPO = [...linkedPOs.values()][0];
    const firstFailed = failedDeliveries[0];
    const expectedTotal = sumExpected(linkedPOs);
    const variance = expectedTotal > 0 ? billedTotal - expectedTotal : null;
    const variancePct =
      expectedTotal > 0 ? Math.abs(variance! / expectedTotal) : null;

    const disputeTaskId = await ensureDisputeTask({
      bill: {
        id: bill.id,
        billNo: bill.billNo,
        billDate: bill.billDate,
        billedTotal,
        supplier: bill.supplier,
      },
      po: firstLinkedPO,
      failedDeliveries,
      deliveredPOs,
    });

    return writeOutcome(bill.id, {
      ...billHeader,
      matchStatus,
      expectedTotal: expectedTotal || null,
      billedTotal,
      varianceAmount: variance,
      variancePct,
      linkedPOCount: linkedPOs.size,
      disputeTaskId,
      notes: describeDeliveryState({
        failedDeliveries,
        awaitingPOs,
        deliveredPOs,
      }),
    });
  }

  // ── AWAITING_DELIVERY (PO linked but no signal yet; pre-Phase-3 safety) ──
  if (hasAwaiting && !hasDelivered) {
    return writeOutcome(bill.id, {
      ...billHeader,
      matchStatus: "AWAITING_DELIVERY",
      expectedTotal: sumExpected(linkedPOs) || null,
      billedTotal,
      varianceAmount: null,
      variancePct: null,
      linkedPOCount: linkedPOs.size,
      notes: describeDeliveryState({
        failedDeliveries,
        awaitingPOs,
        deliveredPOs,
      }),
    });
  }

  // ── Mixed PARTIAL: some delivered, some awaiting (no failures) ──
  if (hasAwaiting && hasDelivered) {
    return writeOutcome(bill.id, {
      ...billHeader,
      matchStatus: "PARTIAL",
      expectedTotal: sumExpected(linkedPOs) || null,
      billedTotal,
      varianceAmount: null,
      variancePct: null,
      linkedPOCount: linkedPOs.size,
      notes: describeDeliveryState({
        failedDeliveries,
        awaitingPOs,
        deliveredPOs,
      }),
    });
  }

  // ── All delivered — check for MOQ overages before final verdict ──
  await detectAndCreateStockOverages(bill);

  // ── All delivered — variance check ──
  const expectedTotal = sumExpected(linkedPOs);
  const variance = billedTotal - expectedTotal;
  const variancePct =
    expectedTotal === 0 ? null : Math.abs(variance / expectedTotal);

  if (variancePct !== null && variancePct > VARIANCE_THRESHOLD) {
    return writeOutcome(bill.id, {
      ...billHeader,
      matchStatus: "VARIANCE",
      expectedTotal,
      billedTotal,
      varianceAmount: variance,
      variancePct,
      linkedPOCount: linkedPOs.size,
      notes: `Variance £${variance.toFixed(2)} (${(variancePct * 100).toFixed(2)} %) exceeds ${VARIANCE_THRESHOLD * 100} % threshold. Expected £${expectedTotal.toFixed(2)}, billed £${billedTotal.toFixed(2)}.`,
    });
  }

  return writeOutcome(bill.id, {
    ...billHeader,
    matchStatus: "MATCHED",
    expectedTotal,
    billedTotal,
    varianceAmount: variance,
    variancePct,
    linkedPOCount: linkedPOs.size,
    notes:
      expectedTotal === 0
        ? "All linked POs delivered; no expected cost data for variance check."
        : `All POs delivered; variance £${variance.toFixed(2)} (${(variancePct! * 100).toFixed(2)} %) within threshold.`,
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function sumExpected(
  pos: Map<string, { expectedTotal: number }>
): number {
  let total = 0;
  for (const p of pos.values()) total += p.expectedTotal;
  return total;
}

function bumpCounter(
  result: RunThreeWayMatchResult,
  status: BillMatchStatus
): void {
  switch (status) {
    case "MATCHED":
      result.matched += 1;
      break;
    case "DISPUTE":
      result.disputed += 1;
      break;
    case "VARIANCE":
      result.variance += 1;
      break;
    case "AWAITING_DELIVERY":
      result.awaitingDelivery += 1;
      break;
    case "AWAITING_BILL":
      result.awaitingBill += 1;
      break;
    case "ORPHAN_BILL":
      result.orphanBill += 1;
      break;
    case "PARTIAL":
      result.partial += 1;
      break;
  }
}

/**
 * Read whatever delivery signal we can infer from LogisticsEvent. Phase 3
 * lands a proper `stopStatus` enum; until then we pattern-match on the
 * free-text `eventType`. Returns "UNKNOWN" when nothing matches so bills
 * don't get falsely disputed pre-Phase-3.
 */
async function probeDelivery(ticketId: string): Promise<DeliverySignal> {
  const events = await prisma.logisticsEvent.findMany({
    where: { ticketId },
    select: { eventType: true, stopStatus: true, timestamp: true },
    orderBy: { timestamp: "desc" },
  });

  if (events.length === 0) return "UNKNOWN";

  // Prefer the structured stopStatus (Phase 3). Fall back to eventType
  // pattern-match for legacy rows with no stopStatus set. Newest-first
  // — first decisive signal wins.
  for (const e of events) {
    if (e.stopStatus === "DELIVERED") return "DELIVERED";
    if (e.stopStatus === "BYPASSED") return "BYPASSED";
    if (e.stopStatus === "NOT_ARRIVED") return "NOT_ARRIVED";
    // DEPARTED / UNKNOWN are not decisive — fall through to next event.
    if (e.stopStatus) continue;

    const t = (e.eventType || "").toUpperCase();
    if (!t) continue;
    if (t.includes("BYPASS")) return "BYPASSED";
    if (
      t.includes("NOT_ARRIVED") ||
      t.includes("NOT ARRIVED") ||
      t === "FAILED" ||
      t.includes("FAILED_DELIVERY")
    ) {
      return "NOT_ARRIVED";
    }
    if (t.includes("DELIVER") && !t.includes("NOT") && !t.includes("FAIL")) {
      return "DELIVERED";
    }
  }
  return "UNKNOWN";
}

interface EnsureDisputeTaskArgs {
  bill: {
    id: string;
    billNo: string;
    billDate: Date;
    billedTotal: number;
    supplier: { id: string; name: string; email: string | null };
  };
  po: { poNo: string; ticketId: string };
  failedDeliveries: Array<{ poNo: string; signal: DeliverySignal }>;
  deliveredPOs: string[];
}

async function ensureDisputeTask(
  args: EnsureDisputeTaskArgs
): Promise<string> {
  const existing = await prisma.task.findFirst({
    where: {
      supplierBillId: args.bill.id,
      taskType: "SUPPLIER_DISPUTE",
      status: { notIn: ["DONE", "RESOLVED", "CLOSED"] },
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const draftBody = buildDisputeEmail(args);
  const reason = `3-way match failed: ${args.failedDeliveries
    .map((f) => `${f.poNo}=${f.signal}`)
    .join(", ")}`;

  const task = await prisma.task.create({
    data: {
      ticketId: args.po.ticketId,
      supplierBillId: args.bill.id,
      taskType: "SUPPLIER_DISPUTE",
      priority: "HIGH",
      status: "OPEN",
      dueAt: new Date(),
      generatedReason: reason,
      draftBody,
    },
    select: { id: true },
  });
  return task.id;
}

function buildDisputeEmail(args: EnsureDisputeTaskArgs): string {
  const { bill, failedDeliveries, deliveredPOs } = args;
  const billDate = bill.billDate.toISOString().slice(0, 10);
  const to = bill.supplier.email || "accounts@supplier.example";
  const amount = bill.billedTotal.toFixed(2);

  const failureLines = failedDeliveries
    .map((f) => `  • PO ${f.poNo} — ${f.signal.replace(/_/g, " ").toLowerCase()}`)
    .join("\n");

  const partialNote = deliveredPOs.length
    ? `\nNote: POs ${deliveredPOs.join(", ")} on this invoice were delivered; our dispute covers only the lines above.\n`
    : "";

  return [
    `To: ${to}`,
    `Subject: Dispute — invoice ${bill.billNo} (non-delivery)`,
    ``,
    `Hi ${bill.supplier.name} accounts team,`,
    ``,
    `We are disputing invoice ${bill.billNo} dated ${billDate} for £${amount} (ex VAT).`,
    `Our delivery record shows the following PO(s) on this invoice did not land:`,
    ``,
    failureLines,
    partialNote,
    `Please either:`,
    `  • Provide a signed POD for each PO above, OR`,
    `  • Issue a credit note / reverse the invoice for the affected lines.`,
    ``,
    `We will hold payment against these lines until delivery is proven or the invoice is corrected. Please reply to this thread with the POD or credit note reference.`,
    ``,
    `Regards,`,
    `Cromwell Freight Accounts`,
  ]
    .filter(Boolean)
    .join("\n");
}

function describeDeliveryState(s: {
  failedDeliveries: Array<{ poNo: string; signal: DeliverySignal }>;
  awaitingPOs: string[];
  deliveredPOs: string[];
}): string {
  const parts: string[] = [];
  if (s.failedDeliveries.length) {
    parts.push(
      `Failed: ${s.failedDeliveries.map((f) => `${f.poNo} (${f.signal})`).join(", ")}`
    );
  }
  if (s.awaitingPOs.length) {
    parts.push(`Awaiting delivery signal: ${s.awaitingPOs.join(", ")}`);
  }
  if (s.deliveredPOs.length) {
    parts.push(`Delivered: ${s.deliveredPOs.join(", ")}`);
  }
  return parts.join("; ");
}

// ─── MOQ overage → stock register ────────────────────────────────────────

/**
 * For each bill line with a CostAllocation → ProcurementOrderLine → TicketLine,
 * compare PO qty vs ticket qty. If PO qty > ticket qty, the excess is MOQ
 * overage → create StockItem with sourceType=MOQ_OVERAGE.
 *
 * This is the ONLY entry path for stock — every StockItem traces to a
 * real bill line with a real cost and a real job.
 */
async function detectAndCreateStockOverages(bill: {
  id: string;
  billNo: string;
  lines: Array<{
    id: string;
    lineTotal: unknown;
    amountExVat: unknown;
    costAllocations: Array<{
      totalCost: unknown;
      procurementLine: {
        id: string;
        lineTotal: unknown;
        procurementOrder: {
          id: string;
          poNo: string;
          ticketId: string;
          totalCostExpected: unknown;
        };
      } | null;
    }>;
  }>;
  supplier: { id: string; name: string };
}) {
  for (const billLine of bill.lines) {
    for (const alloc of billLine.costAllocations) {
      const po = alloc.procurementLine?.procurementOrder;
      if (!po || !alloc.procurementLine) continue;

      const poLine = await prisma.procurementOrderLine.findUnique({
        where: { id: alloc.procurementLine.id },
        select: {
          qty: true,
          unitCost: true,
          description: true,
          ticketLineId: true,
          ticketLine: { select: { id: true, qty: true, description: true, productCode: true } },
        },
      });
      if (!poLine?.ticketLine) continue;

      const billQty = Number(poLine.qty || 0);
      const ticketQty = Number(poLine.ticketLine.qty || 0);
      const unitCost = Number(poLine.unitCost || 0);
      const excess = billQty - ticketQty;

      if (excess <= 0 || unitCost <= 0) continue;

      // Idempotent — don't create duplicate stock items for the same bill line
      const existing = await prisma.stockItem.findFirst({
        where: { originBillId: bill.id, description: poLine.ticketLine.description || poLine.description || "" },
      });
      if (existing) continue;

      await prisma.stockItem.create({
        data: {
          description: poLine.ticketLine.description || poLine.description || "Unknown",
          productCode: poLine.ticketLine.productCode,
          qtyOnHand: excess,
          qtyOriginal: excess,
          unit: "EA",
          costPerUnit: unitCost,
          supplierName: bill.supplier.name,
          originBillId: bill.id,
          originBillNo: bill.billNo,
          originTicketId: po.ticketId,
          originTicketTitle: `T-${po.poNo}`,
          sourceType: "MOQ_OVERAGE",
          outcome: "HOLDING",
          notes: `MOQ overage: ordered ${billQty}, needed ${ticketQty}, excess ${excess}. From bill ${bill.billNo}, job ticket ${po.ticketId}.`,
        },
      });
    }
  }
}

async function writeOutcome(
  billId: string,
  outcome: Omit<ThreeWayMatchOutcome, "billId" | "matchedAt"> & {
    billId?: string;
    billNo: string;
    supplierName: string;
  }
): Promise<ThreeWayMatchOutcome> {
  const matchedAt = new Date();

  const data: Prisma.SupplierBillUpdateInput = {
    matchStatus: outcome.matchStatus,
    matchedAt,
    matchNotes: outcome.notes,
    matchVarianceAmt:
      outcome.varianceAmount === null ? null : outcome.varianceAmount,
  };

  await prisma.supplierBill.update({
    where: { id: billId },
    data,
  });

  return {
    billId,
    billNo: outcome.billNo,
    supplierName: outcome.supplierName,
    matchStatus: outcome.matchStatus,
    matchedAt,
    expectedTotal: outcome.expectedTotal,
    billedTotal: outcome.billedTotal,
    varianceAmount: outcome.varianceAmount,
    variancePct: outcome.variancePct,
    linkedPOCount: outcome.linkedPOCount,
    disputeTaskId: outcome.disputeTaskId,
    notes: outcome.notes,
  };
}

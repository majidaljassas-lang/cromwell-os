/**
 * Reconciliation Engine (Upgraded)
 *
 * Does NOT operate on simple totals. Considers:
 * - order coverage completeness
 * - allocation completeness
 * - UOM validity
 * - substitution logic
 *
 * Outputs per product:
 * - ORDERED_QTY, SUPPLIED_QTY, BILLED_QTY
 * - ORDER_GAP, BILLING_GAP
 *
 * Blocks COMPLETE if:
 * - order coverage incomplete
 * - invoice allocation incomplete
 * - UOM unresolved
 * - substitution not evidenced
 */

import { prisma } from "@/lib/prisma";
import { getFamilyMembers } from "./substitution";

export interface ProductReconciliation {
  canonicalProductId: string;
  productCode: string;
  productName: string;
  category: string | null;
  canonicalUom: string;
  orderedQty: number;
  suppliedQty: number;
  billedQty: number;
  baseQty: number;
  recoverableQty: number;
  sellTotal: number;
  costTotal: number;
  marginTotal: number;
  marginPct: number | null;
  orderGap: number;
  billingGap: number;
  status: string;
  familyStatus: string | null;
  uomValid: boolean;
  allocationComplete: boolean;
  orderCoverageComplete: boolean;
  substitutionEvidenced: boolean;
  invoiceStatus: string | null;
  orderEvents: OrderEventDetail[];
  invoiceLines: InvoiceLineDetail[];
  supplyEvents: SupplyEventDetail[];
  billLineLinks: BillLineLinkDetail[];
}

export interface OrderEventDetail {
  id: string;
  eventType: string;
  qty: number;
  rawUom: string;
  normalisedQty: number | null;
  uomResolved: boolean;
  timestamp: string;
  sourceText: string | null;
  sourceMessageId: string | null;
  orderGroupLabel: string;
}

export interface InvoiceLineDetail {
  id: string;
  invoiceNumber: string;
  invoiceStatus: string;
  description: string;
  qty: number;
  rawUom: string;
  normalisedQty: number | null;
  uomResolved: boolean;
  sellRate: number | null;
  sellAmount: number | null;
  allocationStatus: string;
  allocatedOrderGroupId: string | null;
  allocatedOrderGroupLabel: string | null;
}

export interface SupplyEventDetail {
  id: string;
  fulfilmentType: string;
  qty: number;
  rawUom: string;
  normalisedQty: number | null;
  uomResolved: boolean;
  timestamp: string;
  sourceRef: string | null;
  evidenceRef: string | null;
}

export interface BillLineLinkDetail {
  id: string;
  billNumber: string;
  supplierName: string | null;
  description: string;
  qty: number;
  costRate: number | null;
  costAmount: number | null;
  marginAmount: number | null;
  marginPct: number | null;
  costLinkStatus: string;
}

function d(v: unknown): number {
  if (v === null || v === undefined) return 0;
  return Number(v);
}

/**
 * Run full reconciliation for a given site.
 * Returns per-product reconciliation details.
 */
export async function runReconciliation(siteId: string): Promise<ProductReconciliation[]> {
  // Get all canonical products that have activity on this site
  const products = await prisma.canonicalProduct.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
  });

  const results: ProductReconciliation[] = [];

  for (const product of products) {
    // Fetch order events for this product+site
    const orderEvents = await prisma.orderEvent.findMany({
      where: { canonicalProductId: product.id, siteId },
      include: { orderGroup: true },
      orderBy: { timestamp: "asc" },
    });

    // Fetch supply events
    const supplyEvents = await prisma.supplyEvent.findMany({
      where: { canonicalProductId: product.id, siteId },
      orderBy: { timestamp: "asc" },
    });

    // Fetch invoice lines
    const invoiceLines = await prisma.commercialInvoiceLine.findMany({
      where: { canonicalProductId: product.id, commercialInvoice: { siteId } },
      include: {
        commercialInvoice: true,
        allocations: { include: { orderGroup: true } },
        billLineLinks: {
          include: { commercialBillLine: { include: { commercialBill: true } } },
        },
      },
    });

    // Skip products with no activity
    if (orderEvents.length === 0 && supplyEvents.length === 0 && invoiceLines.length === 0) {
      continue;
    }

    // Calculate ordered qty (only from demand-side events, using normalised qty where available)
    let orderedQty = 0;
    let hasUomIssue = false;

    for (const oe of orderEvents) {
      const qty = oe.uomResolved ? d(oe.normalisedQty) : d(oe.qty);
      if (!oe.uomResolved) hasUomIssue = true;

      switch (oe.eventType) {
        case "INITIAL_ORDER":
        case "ADDITION":
        case "SUBSTITUTION_IN":
        case "CONFIRMATION":
          orderedQty += qty;
          break;
        case "REDUCTION":
        case "SUBSTITUTION_OUT":
        case "CANCELLATION":
          orderedQty -= qty;
          break;
        case "QUERY_ONLY":
          break;
      }
    }

    // Calculate supplied qty
    let suppliedQty = 0;
    for (const se of supplyEvents) {
      const qty = se.uomResolved ? d(se.normalisedQty) : d(se.qty);
      if (!se.uomResolved) hasUomIssue = true;

      switch (se.fulfilmentType) {
        case "DELIVERED":
        case "PART_DELIVERED":
        case "SUBSTITUTED":
          suppliedQty += qty;
          break;
        case "RETURNED":
        case "CREDITED":
          suppliedQty -= qty;
          break;
      }
    }

    // Calculate billed qty + sell total
    let billedQty = 0;
    let sellTotal = 0;
    let allInvoiceLinesAllocated = true;

    for (const il of invoiceLines) {
      const qty = il.uomResolved ? d(il.normalisedQty) : d(il.qty);
      if (!il.uomResolved) hasUomIssue = true;
      billedQty += qty;
      sellTotal += d(il.sellAmount);
      if (il.allocationStatus !== "ALLOCATED") allInvoiceLinesAllocated = false;
    }

    // Calculate cost total from bill line links
    let costTotal = 0;
    const billDetails: BillLineLinkDetail[] = [];
    for (const il of invoiceLines) {
      for (const bll of il.billLineLinks) {
        costTotal += d(bll.costAmount);
        billDetails.push({
          id: bll.id,
          billNumber: bll.commercialBillLine.commercialBill.billNumber,
          supplierName: bll.commercialBillLine.commercialBill.supplierName,
          description: bll.commercialBillLine.description,
          qty: d(bll.linkedQty),
          costRate: d(bll.costRate),
          costAmount: d(bll.costAmount),
          marginAmount: d(bll.marginAmount),
          marginPct: d(bll.marginPct),
          costLinkStatus: bll.costLinkStatus,
        });
      }
    }

    // Margin
    const marginTotal = sellTotal - costTotal;
    const marginPct = sellTotal > 0 ? (marginTotal / sellTotal) * 100 : null;

    // BASE_QTY = max(ORDER_QTY, SUPPLY_QTY) — do not cap at ordered
    const baseQty = Math.max(orderedQty, suppliedQty);

    // RECOVERABLE_QTY = BASE_QTY - INVOICE_QTY — what can still be invoiced
    const recoverableQty = Math.max(0, baseQty - billedQty);

    // Gaps
    const orderGap = suppliedQty - orderedQty;   // positive = over-supplied
    const billingGap = baseQty - billedQty;       // positive = underbilled (against base, not just order)

    // Order coverage: all order events must have resolved UOM
    const orderCoverageComplete = orderEvents.length > 0 && orderEvents.every((oe) => oe.uomResolved);

    // Substitution check
    const familyMembers = await getFamilyMembers(product.code);
    let familyStatus: string | null = null;
    let substitutionEvidenced = true;

    if (familyMembers.length > 1) {
      // Check if any supply/billing uses family members
      const hasSubstitution = supplyEvents.some((se) => se.fulfilmentType === "SUBSTITUTED");
      if (hasSubstitution) {
        familyStatus = "SATISFIED_BY_SUBSTITUTION";
        // Check evidence exists for substitutions
        const subsWithoutEvidence = supplyEvents.filter(
          (se) => se.fulfilmentType === "SUBSTITUTED" && !se.evidenceRef
        );
        if (subsWithoutEvidence.length > 0) {
          substitutionEvidenced = false;
        }
      }
    }

    // Determine status
    const uomValid = !hasUomIssue;
    let status = determineReconciliationStatus({
      orderedQty,
      suppliedQty,
      billedQty,
      baseQty,
      recoverableQty,
      uomValid,
      allocationComplete: allInvoiceLinesAllocated,
      orderCoverageComplete,
      substitutionEvidenced,
      familyStatus,
    });

    // Get most recent invoice status
    const invoiceStatuses = invoiceLines.map((il) => il.commercialInvoice.invoiceStatus);
    const invoiceStatus = invoiceStatuses.length > 0 ? invoiceStatuses[0] : null;

    // Persist reconciliation result
    const reconData = {
      orderedQty,
      suppliedQty,
      billedQty,
      baseQty,
      recoverableQty,
      sellTotal,
      costTotal,
      marginTotal,
      marginPct,
      orderGap,
      billingGap,
      status: status as any,
      familyStatus,
      uomValid,
      allocationComplete: allInvoiceLinesAllocated,
      orderCoverageComplete,
      substitutionEvidenced,
    };

    await prisma.reconciliationResult.upsert({
      where: { siteId_canonicalProductId: { siteId, canonicalProductId: product.id } },
      create: { siteId, canonicalProductId: product.id, ...reconData },
      update: { ...reconData, lastCalculatedAt: new Date() },
    });

    results.push({
      canonicalProductId: product.id,
      productCode: product.code,
      productName: product.name,
      category: product.category,
      canonicalUom: product.canonicalUom,
      orderedQty,
      suppliedQty,
      billedQty,
      baseQty,
      recoverableQty,
      sellTotal,
      costTotal,
      marginTotal,
      marginPct,
      orderGap,
      billingGap,
      status,
      familyStatus,
      uomValid,
      allocationComplete: allInvoiceLinesAllocated,
      orderCoverageComplete,
      substitutionEvidenced,
      invoiceStatus,
      orderEvents: orderEvents.map((oe) => ({
        id: oe.id,
        eventType: oe.eventType,
        qty: d(oe.qty),
        rawUom: oe.rawUom,
        normalisedQty: oe.normalisedQty ? d(oe.normalisedQty) : null,
        uomResolved: oe.uomResolved,
        timestamp: oe.timestamp.toISOString(),
        sourceText: oe.sourceText,
        sourceMessageId: oe.sourceMessageId,
        orderGroupLabel: oe.orderGroup.label,
      })),
      invoiceLines: invoiceLines.map((il) => ({
        id: il.id,
        invoiceNumber: il.commercialInvoice.invoiceNumber,
        invoiceStatus: il.commercialInvoice.invoiceStatus,
        description: il.description,
        qty: d(il.qty),
        rawUom: il.rawUom,
        normalisedQty: il.normalisedQty ? d(il.normalisedQty) : null,
        uomResolved: il.uomResolved,
        sellRate: d(il.sellRate),
        sellAmount: d(il.sellAmount),
        allocationStatus: il.allocationStatus,
        allocatedOrderGroupId: il.allocations[0]?.orderGroupId ?? null,
        allocatedOrderGroupLabel: il.allocations[0]?.orderGroup.label ?? null,
      })),
      supplyEvents: supplyEvents.map((se) => ({
        id: se.id,
        fulfilmentType: se.fulfilmentType,
        qty: d(se.qty),
        rawUom: se.rawUom,
        normalisedQty: se.normalisedQty ? d(se.normalisedQty) : null,
        uomResolved: se.uomResolved,
        timestamp: se.timestamp.toISOString(),
        sourceRef: se.sourceRef,
        evidenceRef: se.evidenceRef,
      })),
      billLineLinks: billDetails,
    });
  }

  return results;
}

function determineReconciliationStatus(params: {
  orderedQty: number;
  suppliedQty: number;
  billedQty: number;
  baseQty: number;
  recoverableQty: number;
  uomValid: boolean;
  allocationComplete: boolean;
  orderCoverageComplete: boolean;
  substitutionEvidenced: boolean;
  familyStatus: string | null;
}): string {
  const {
    orderedQty,
    suppliedQty,
    billedQty,
    baseQty,
    recoverableQty,
    uomValid,
    allocationComplete,
    orderCoverageComplete,
    substitutionEvidenced,
    familyStatus,
  } = params;

  // Block COMPLETE if any of these are unresolved
  if (!uomValid) return "REVIEW_REQUIRED_RECON";
  if (!orderCoverageComplete) return "REVIEW_REQUIRED_RECON";
  if (!allocationComplete) return "REVIEW_REQUIRED_RECON";
  if (!substitutionEvidenced) return "REVIEW_REQUIRED_RECON";

  // If family substitution used and satisfied
  if (familyStatus === "SATISFIED_BY_SUBSTITUTION") {
    return "SATISFIED_BY_SUBSTITUTION";
  }

  // No billing yet
  if (billedQty === 0 && baseQty > 0) return "AWAITING_INVOICE";

  // Over-supplied AND underbilled — recovery opportunity against supply, not just order
  const isOverSupplied = suppliedQty > orderedQty;
  const isUnderbilled = billedQty < baseQty;
  const isOverbilled = billedQty > baseQty;

  if (isOverSupplied && isUnderbilled) return "OVER_SUPPLIED_UNDERBILLED";
  if (isOverSupplied && !isUnderbilled) return "OVER_SUPPLIED";
  if (isUnderbilled) return "UNDERBILLED";
  if (isOverbilled) return "OVERBILLED";

  // All clear — billed matches base qty
  return "COMPLETE";
}

/**
 * Determine the closure status for an order group based on its reconciliation state
 * and the Zoho invoice statuses of allocated invoice lines.
 */
export async function calculateClosureStatus(orderGroupId: string): Promise<string> {
  const group = await prisma.orderGroup.findUnique({
    where: { id: orderGroupId },
    include: {
      orderEvents: true,
      invoiceLineAllocations: {
        include: {
          commercialInvoiceLine: {
            include: { commercialInvoice: true },
          },
        },
      },
    },
  });

  if (!group) return "OPEN";

  const allocations = group.invoiceLineAllocations;
  if (allocations.length === 0) return "OPEN";

  const invoiceStatuses = allocations.map(
    (a) => a.commercialInvoiceLine.commercialInvoice.invoiceStatus
  );

  // Check if any UOM issues exist in order events
  const hasUomIssues = group.orderEvents.some((oe) => !oe.uomResolved);
  if (hasUomIssues) return "REVIEW_REQUIRED";

  // Check invoice status progression
  const allPaid = invoiceStatuses.every((s) => s === "PAID");
  const anyVoid = invoiceStatuses.some((s) => s === "VOID");
  const anyOverdue = invoiceStatuses.some((s) => s === "OVERDUE");
  const allSent = invoiceStatuses.every((s) => s === "SENT" || s === "PAID" || s === "PART_PAID");
  const anyPartPaid = invoiceStatuses.some((s) => s === "PART_PAID");
  const allDraft = invoiceStatuses.every((s) => s === "DRAFT");

  if (anyVoid) return "DISPUTED";
  if (allPaid) return "CLOSED";
  if (anyPartPaid) return "PART_PAID_CLOSURE";
  if (anyOverdue) return "SENT_AWAITING_PAYMENT";
  if (allSent) return "SENT_AWAITING_PAYMENT";
  if (allDraft) return "BILLED_NOT_SENT";

  return "PARTIALLY_BILLED";
}

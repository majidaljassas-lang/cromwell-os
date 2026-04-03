/**
 * Fix 2: Automatic Cost Allocation
 *
 * Uses matching engine to suggest ticket/ticket line allocation.
 * Auto-apply only if confidence > threshold.
 * Must be reversible and audited.
 * Low/medium confidence → review queue.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit";

const AUTO_ALLOCATE_THRESHOLD = 85;
const SUGGEST_THRESHOLD = 60;

export interface AllocationSuggestion {
  supplierBillLineId: string;
  supplierBillLineDescription: string;
  ticketLineId: string;
  ticketLineDescription: string;
  ticketId: string;
  ticketTitle: string;
  confidence: number;
  reasons: string[];
  action: "AUTO_ALLOCATED" | "SUGGESTED" | "NO_MATCH";
}

export async function suggestAllocations(supplierBillLineId: string): Promise<AllocationSuggestion[]> {
  const billLine = await prisma.supplierBillLine.findUnique({
    where: { id: supplierBillLineId },
    include: { supplierBill: { include: { supplier: true } } },
  });

  if (!billLine) return [];

  // Don't allocate non-BILLABLE lines
  if (billLine.costClassification !== "BILLABLE") return [];

  // Don't allocate lines with BLOCKED commercial status
  if (billLine.commercialStatus === "BLOCKED_VAT_UNKNOWN") return [];

  // Find candidate ticket lines
  const candidates = await prisma.ticketLine.findMany({
    where: {
      ...(billLine.ticketId ? { ticketId: billLine.ticketId } : {}),
      ...(billLine.siteId ? { siteId: billLine.siteId } : {}),
      status: { not: "CLOSED" },
    },
    include: { ticket: { select: { id: true, title: true } } },
  });

  const suggestions: AllocationSuggestion[] = [];

  for (const candidate of candidates) {
    let confidence = 0;
    const reasons: string[] = [];

    // Normalised name match
    const billNorm = (billLine.normalizedItemName || billLine.description).toLowerCase();
    const candNorm = (candidate.normalizedItemName || candidate.description).toLowerCase();

    if (billNorm === candNorm) {
      confidence += 40;
      reasons.push("Exact normalised name match");
    } else if (billNorm.includes(candNorm) || candNorm.includes(billNorm)) {
      confidence += 25;
      reasons.push("Partial name match");
    } else {
      const billWords = new Set(billNorm.split(/\s+/));
      const candWords = new Set(candNorm.split(/\s+/));
      const overlap = [...billWords].filter((w) => candWords.has(w) && w.length > 2).length;
      if (overlap >= 2) {
        confidence += 15 * Math.min(overlap, 3);
        reasons.push(`${overlap} word overlap`);
      }
    }

    // Same ticket boost
    if (billLine.ticketId && billLine.ticketId === candidate.ticketId) {
      confidence += 20;
      reasons.push("Same ticket");
    }

    // Same site boost
    if (billLine.siteId && billLine.siteId === candidate.siteId) {
      confidence += 15;
      reasons.push("Same site");
    }

    // Quantity match
    if (Number(billLine.qty) === Number(candidate.qty)) {
      confidence += 10;
      reasons.push("Quantity matches");
    }

    if (confidence >= SUGGEST_THRESHOLD) {
      suggestions.push({
        supplierBillLineId: billLine.id,
        supplierBillLineDescription: billLine.description,
        ticketLineId: candidate.id,
        ticketLineDescription: candidate.description,
        ticketId: candidate.ticket.id,
        ticketTitle: candidate.ticket.title,
        confidence: Math.min(confidence, 99),
        reasons,
        action: confidence >= AUTO_ALLOCATE_THRESHOLD ? "AUTO_ALLOCATED" : "SUGGESTED",
      });
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions;
}

export async function autoAllocate(supplierBillLineId: string, actor?: string): Promise<AllocationSuggestion | null> {
  const suggestions = await suggestAllocations(supplierBillLineId);

  const autoMatch = suggestions.find((s) => s.action === "AUTO_ALLOCATED");
  if (!autoMatch) return null;

  const billLine = await prisma.supplierBillLine.findUnique({
    where: { id: supplierBillLineId },
    include: { supplierBill: { select: { supplierId: true } } },
  });
  if (!billLine) return null;

  await prisma.$transaction(async (tx) => {
    await tx.costAllocation.create({
      data: {
        ticketLineId: autoMatch.ticketLineId,
        supplierBillLineId,
        supplierId: billLine.supplierBill.supplierId,
        qtyAllocated: billLine.qty,
        unitCost: billLine.unitCost,
        totalCost: billLine.lineTotal,
        allocationStatus: "MATCHED",
        confidenceScore: autoMatch.confidence,
        notes: `Auto-allocated: ${autoMatch.reasons.join(", ")}`,
      },
    });

    await tx.supplierBillLine.update({
      where: { id: supplierBillLineId },
      data: { allocationStatus: "MATCHED" },
    });
  });

  await logAudit({
    objectType: "CostAllocation",
    objectId: supplierBillLineId,
    actionType: "AUTO_ALLOCATED",
    actor: actor || "SYSTEM",
    newValue: {
      ticketLineId: autoMatch.ticketLineId,
      confidence: autoMatch.confidence,
      reasons: autoMatch.reasons,
    },
    reason: `Auto-allocated at confidence ${autoMatch.confidence}`,
  });

  return autoMatch;
}

import { prisma } from "@/lib/prisma";

/**
 * Auto-match supplier bills to ticket lines / POs.
 *
 * Strategy (in order, first hit wins):
 *  1. PO number reference   — SupplierBill.billNo / siteRef / customerRef
 *                             contains a known ProcurementOrder.poNo
 *                             (or supplierRef). We then pick the best
 *                             PO line / ticket line by description + qty.
 *  2. Site + description    — SupplierBillLine.siteId matches a ticket
 *                             with a fuzzy description hit on a ticket line.
 *  3. Description only      — pure fuzzy description match across all
 *                             active tickets (lower confidence, marked
 *                             SUGGESTED rather than MATCHED).
 *
 * Idempotent: already-allocated bill lines are skipped.
 * Uses select-only queries on TicketLine to avoid deserialising legacy
 * TicketLine.status values that are missing from the current Prisma enum.
 */
export async function POST() {
  try {
    // 1. Fetch all UNALLOCATED supplier bill lines.
    const unallocatedLines = await prisma.supplierBillLine.findMany({
      where: { allocationStatus: "UNALLOCATED" as any },
      select: {
        id: true,
        description: true,
        normalizedItemName: true,
        qty: true,
        unitCost: true,
        lineTotal: true,
        siteId: true,
        ticketId: true,
        supplierBill: {
          select: {
            id: true,
            billNo: true,
            siteRef: true,
            customerRef: true,
            supplierId: true,
            supplier: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (unallocatedLines.length === 0) {
      return Response.json({
        ok: true,
        scanned: 0,
        matched: 0,
        skipped: 0,
        unmatched: 0,
        details: [],
        message: "No unallocated bill lines found",
      });
    }

    // 2. Build PO lookup index.
    const procurementOrders = await prisma.procurementOrder.findMany({
      select: {
        id: true,
        poNo: true,
        supplierRef: true,
        ticketId: true,
        lines: {
          select: {
            id: true,
            ticketLineId: true,
            description: true,
            qty: true,
            ticketLine: {
              select: {
                id: true,
                description: true,
                normalizedItemName: true,
                qty: true,
              },
            },
          },
        },
      },
    });

    const poByNumber = new Map<string, (typeof procurementOrders)[number]>();
    for (const po of procurementOrders) {
      if (po.poNo) poByNumber.set(po.poNo.toLowerCase(), po);
      if (po.supplierRef) poByNumber.set(po.supplierRef.toLowerCase(), po);
    }

    // 3. Active tickets with lines (for site/description fallback).
    const activeTickets = await prisma.ticket.findMany({
      where: {
        status: { notIn: ["CLOSED", "INVOICED"] as any },
      },
      select: {
        id: true,
        siteId: true,
        lines: {
          select: {
            id: true,
            description: true,
            normalizedItemName: true,
            qty: true,
          },
        },
      },
    });

    const results = {
      ok: true,
      scanned: unallocatedLines.length,
      matched: 0,
      skipped: 0,
      unmatched: 0,
      details: [] as {
        billLineId: string;
        billNo: string;
        description: string;
        matchType: string;
        ticketLineId?: string;
        ticketId?: string;
      }[],
    };

    for (const billLine of unallocatedLines) {
      const bill = billLine.supplierBill;

      // Idempotency: skip if a CostAllocation already exists for this bill line.
      const existingAllocation = await prisma.costAllocation.findFirst({
        where: { supplierBillLineId: billLine.id },
        select: { id: true },
      });
      if (existingAllocation) {
        results.skipped++;
        continue;
      }

      let matchedTicketLineId: string | null = null;
      let matchedTicketId: string | null = null;
      let matchType = "";

      // ── Strategy A: PO number reference ─────────────────────────────────
      const refsToCheck = [
        bill.billNo,
        bill.siteRef,
        bill.customerRef,
      ].filter(Boolean) as string[];

      for (const ref of refsToCheck) {
        const needle = ref.toLowerCase();
        for (const [poKey, po] of poByNumber.entries()) {
          if (needle.includes(poKey)) {
            const bestLineId = findBestLineMatch(
              billLine.description,
              billLine.normalizedItemName,
              Number(billLine.qty),
              po.lines
                .filter((l) => !!l.ticketLineId)
                .map((l) => ({
                  id: l.ticketLineId as string,
                  description: l.description,
                  normalizedItemName:
                    l.ticketLine?.normalizedItemName ?? null,
                  qty: Number(l.qty),
                }))
            );
            if (bestLineId) {
              matchedTicketLineId = bestLineId;
              matchedTicketId = po.ticketId;
              matchType = "PO_REFERENCE";
            }
            break;
          }
        }
        if (matchedTicketLineId) break;
      }

      // ── Strategy B: Site + description ──────────────────────────────────
      if (!matchedTicketLineId) {
        for (const ticket of activeTickets) {
          const siteMatch =
            (billLine.siteId && ticket.siteId === billLine.siteId) ||
            (!!billLine.ticketId && ticket.id === billLine.ticketId);
          if (!siteMatch) continue;

          const bestLineId = findBestLineMatch(
            billLine.description,
            billLine.normalizedItemName,
            Number(billLine.qty),
            ticket.lines.map((l) => ({
              id: l.id,
              description: l.description,
              normalizedItemName: l.normalizedItemName,
              qty: Number(l.qty),
            }))
          );
          if (bestLineId) {
            matchedTicketLineId = bestLineId;
            matchedTicketId = ticket.id;
            matchType = "SITE_AND_DESCRIPTION";
            break;
          }
        }
      }

      // ── Strategy C: Pure description match ──────────────────────────────
      if (!matchedTicketLineId) {
        let bestScore = 0;
        for (const ticket of activeTickets) {
          for (const line of ticket.lines) {
            const score = descriptionSimilarity(
              billLine.description,
              billLine.normalizedItemName,
              line.description,
              line.normalizedItemName
            );
            if (score > bestScore && score >= 0.6) {
              bestScore = score;
              matchedTicketLineId = line.id;
              matchedTicketId = ticket.id;
              matchType = "DESCRIPTION_ONLY";
            }
          }
        }
      }

      if (matchedTicketLineId && matchedTicketId) {
        const finalStatus =
          matchType === "DESCRIPTION_ONLY" ? "SUGGESTED" : "MATCHED";
        const confidence =
          matchType === "PO_REFERENCE"
            ? 95
            : matchType === "DESCRIPTION_ONLY"
              ? 60
              : 80;

        await prisma.$transaction(async (tx) => {
          await tx.costAllocation.create({
            data: {
              ticketLineId: matchedTicketLineId!,
              supplierBillLineId: billLine.id,
              supplierId: bill.supplierId,
              qtyAllocated: billLine.qty,
              unitCost: billLine.unitCost,
              totalCost: billLine.lineTotal,
              allocationStatus: finalStatus as any,
              confidenceScore: confidence,
              notes: `Auto-matched via ${matchType}`,
            },
          });

          await tx.supplierBillLine.update({
            where: { id: billLine.id },
            data: { allocationStatus: finalStatus as any },
          });

          await tx.event.create({
            data: {
              ticketId: matchedTicketId!,
              ticketLineId: matchedTicketLineId,
              eventType: "AUTO_BILL_MATCHED" as any,
              timestamp: new Date(),
              notes: `Bill ${bill.billNo} line "${billLine.description}" auto-matched via ${matchType} (£${Number(
                billLine.lineTotal
              ).toFixed(2)})`,
            },
          });
        });

        results.matched++;
        results.details.push({
          billLineId: billLine.id,
          billNo: bill.billNo,
          description: billLine.description,
          matchType,
          ticketLineId: matchedTicketLineId,
          ticketId: matchedTicketId,
        });
      } else {
        results.unmatched++;
        results.details.push({
          billLineId: billLine.id,
          billNo: bill.billNo,
          description: billLine.description,
          matchType: "NO_MATCH",
        });
      }
    }

    return Response.json({
      ...results,
      message: `Processed ${unallocatedLines.length} lines: ${results.matched} matched, ${results.skipped} skipped, ${results.unmatched} unmatched`,
    });
  } catch (error) {
    console.error("Auto-match bills failed:", error);
    return Response.json(
      {
        error: "Auto-match bills failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// ─── Matching helpers ────────────────────────────────────────────────────────

interface MatchCandidate {
  id: string;
  description: string;
  normalizedItemName: string | null;
  qty: number;
}

function findBestLineMatch(
  billDesc: string,
  billNormalized: string | null,
  billQty: number,
  candidates: MatchCandidate[]
): string | null {
  let bestId: string | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    if (!candidate.id) continue;

    let score = descriptionSimilarity(
      billDesc,
      billNormalized,
      candidate.description,
      candidate.normalizedItemName
    );

    // Boost score for matching quantities.
    if (billQty > 0 && candidate.qty > 0 && billQty === candidate.qty) {
      score += 0.15;
    }

    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return bestId;
}

function descriptionSimilarity(
  desc1: string,
  norm1: string | null,
  desc2: string,
  norm2: string | null
): number {
  const a = (norm1 || desc1 || "").toLowerCase().trim();
  const b = (norm2 || desc2 || "").toLowerCase().trim();

  if (!a || !b) return 0;
  if (a === b) return 1.0;

  const tokensA = new Set(a.split(/[\s,.\-/]+/).filter((t) => t.length > 1));
  const tokensB = new Set(b.split(/[\s,.\-/]+/).filter((t) => t.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return overlap / union;
}

import { prisma } from "@/lib/prisma";

/**
 * Auto-match supplier bills to ticket lines / POs.
 *
 * Strategy:
 *  1. PO number match  — bill.siteRef or bill.customerRef contains a ProcurementOrder.poNo
 *  2. Product match    — normalizedItemName / description overlap between bill line and ticket line
 *  3. Site match       — bill line siteId matches ticket siteId
 *
 * Idempotent: already-matched lines are skipped.
 */
export async function POST() {
  try {
    // 1. Fetch all UNALLOCATED supplier bill lines
    const unallocatedLines = await prisma.supplierBillLine.findMany({
      where: { allocationStatus: "UNALLOCATED" },
      include: {
        supplierBill: { include: { supplier: true } },
      },
    });

    if (unallocatedLines.length === 0) {
      return Response.json({
        matched: 0,
        skipped: 0,
        unmatched: 0,
        details: [],
        message: "No unallocated bill lines found",
      });
    }

    // 2. Build lookup indexes
    const procurementOrders = await prisma.procurementOrder.findMany({
      include: {
        lines: { include: { ticketLine: true } },
        ticket: true,
      },
    });

    // Map PO numbers to their procurement orders (case-insensitive)
    const poByNumber = new Map<string, typeof procurementOrders[number]>();
    for (const po of procurementOrders) {
      poByNumber.set(po.poNo.toLowerCase(), po);
      if (po.supplierRef) {
        poByNumber.set(po.supplierRef.toLowerCase(), po);
      }
    }

    // Active tickets with lines for fallback matching
    const activeTickets = await prisma.ticket.findMany({
      where: {
        status: { notIn: ["CLOSED", "INVOICED"] },
      },
      include: { lines: true },
    });

    const results = {
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

      // Already has a cost allocation? Skip (idempotent)
      const existingAllocation = await prisma.costAllocation.findFirst({
        where: { supplierBillLineId: billLine.id },
      });
      if (existingAllocation) {
        results.skipped++;
        continue;
      }

      let matchedTicketLineId: string | null = null;
      let matchedTicketId: string | null = null;
      let matchType = "";

      // Strategy A: PO number reference match
      const refsToCheck = [
        bill.siteRef,
        bill.customerRef,
        bill.billNo,
      ].filter(Boolean) as string[];

      for (const ref of refsToCheck) {
        // Check if reference contains a PO number
        for (const [poKey, po] of poByNumber.entries()) {
          if (ref.toLowerCase().includes(poKey)) {
            // Found PO match — now match the bill line to a PO line
            const bestPoLine = findBestLineMatch(
              billLine.description,
              billLine.normalizedItemName,
              Number(billLine.qty),
              po.lines.map((l: { ticketLineId: string | null; description: string; ticketLine: { normalizedItemName: string | null } | null; qty: unknown }) => ({
                id: l.ticketLineId || "",
                description: l.description,
                normalizedItemName: l.ticketLine?.normalizedItemName || null,
                qty: Number(l.qty),
              }))
            );

            if (bestPoLine) {
              matchedTicketLineId = bestPoLine;
              matchedTicketId = po.ticketId;
              matchType = "PO_REFERENCE";
            }
            break;
          }
        }
        if (matchedTicketLineId) break;
      }

      // Strategy B: Product description + site match
      if (!matchedTicketLineId) {
        for (const ticket of activeTickets) {
          // If bill line has a siteId, try to match ticket by site
          const siteMatch = billLine.siteId && ticket.siteId === billLine.siteId;
          // If bill line has a ticketId already set, use that
          const ticketRefMatch = billLine.ticketId && ticket.id === billLine.ticketId;

          if (siteMatch || ticketRefMatch) {
            const bestLine = findBestLineMatch(
              billLine.description,
              billLine.normalizedItemName,
              Number(billLine.qty),
              ticket.lines.map((l: { id: string; description: string; normalizedItemName: string | null; qty: unknown }) => ({
                id: l.id,
                description: l.description,
                normalizedItemName: l.normalizedItemName,
                qty: Number(l.qty),
              }))
            );

            if (bestLine) {
              matchedTicketLineId = bestLine;
              matchedTicketId = ticket.id;
              matchType = siteMatch ? "SITE_AND_DESCRIPTION" : "TICKET_REF_AND_DESCRIPTION";
              break;
            }
          }
        }
      }

      // Strategy C: Pure description match across all active tickets (lower confidence)
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
        // Create CostAllocation
        await prisma.$transaction(async (tx: typeof prisma) => {
          await tx.costAllocation.create({
            data: {
              ticketLineId: matchedTicketLineId!,
              supplierBillLineId: billLine.id,
              supplierId: bill.supplierId,
              qtyAllocated: billLine.qty,
              unitCost: billLine.unitCost,
              totalCost: billLine.lineTotal,
              allocationStatus: matchType === "DESCRIPTION_ONLY" ? "SUGGESTED" : "MATCHED",
              confidenceScore: matchType === "PO_REFERENCE" ? 95 : matchType === "DESCRIPTION_ONLY" ? 60 : 80,
              notes: `Auto-matched via ${matchType}`,
            },
          });

          await tx.supplierBillLine.update({
            where: { id: billLine.id },
            data: {
              allocationStatus: matchType === "DESCRIPTION_ONLY" ? "SUGGESTED" : "MATCHED",
            },
          });
        });

        // Log event on the ticket
        await prisma.event.create({
          data: {
            ticketId: matchedTicketId,
            ticketLineId: matchedTicketLineId,
            eventType: "AUTO_BILL_MATCHED",
            timestamp: new Date(),
            notes: `Bill ${bill.billNo} line "${billLine.description}" auto-matched via ${matchType} (£${Number(billLine.lineTotal).toFixed(2)})`,
          },
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
      { error: "Auto-match bills failed" },
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

    // Boost score for matching quantities
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
  // Use normalized names if available, else raw descriptions
  const a = (norm1 || desc1).toLowerCase().trim();
  const b = (norm2 || desc2).toLowerCase().trim();

  if (a === b) return 1.0;

  // Token overlap scoring
  const tokensA = new Set(a.split(/[\s,.\-/]+/).filter((t) => t.length > 1));
  const tokensB = new Set(b.split(/[\s,.\-/]+/).filter((t) => t.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap++;
  }

  // Jaccard-like score
  const union = new Set([...tokensA, ...tokensB]).size;
  return overlap / union;
}

import { prisma } from "@/lib/prisma";
import { AllocationStatus } from "@/generated/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatchResult {
  billLineId: string;
  ticketLineId: string;
  strategy: "PO_REFERENCE" | "DESCRIPTION_SUPPLIER" | "PRODUCT_CODE";
  confidence: number;
  matchedQty: number;
  matchedUnitCost: number;
  matchedTotal: number;
}

export interface ProcessingResult {
  billId: string;
  journalEntryId: string | null;
  matchSummary: {
    totalLines: number;
    matched: number;
    partial: number;
    unallocated: number;
  };
  matches: MatchResult[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Text normalisation helpers
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 1); // drop single-char noise
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hits = a.filter((t) => setB.has(t)).length;
  // Jaccard-ish: overlap relative to the smaller set
  return hits / Math.min(a.length, b.length);
}

function qtyCloseEnough(a: number, b: number): boolean {
  if (a === 0 && b === 0) return true;
  const max = Math.max(Math.abs(a), Math.abs(b));
  if (max === 0) return true;
  return Math.abs(a - b) / max <= 0.1; // within ±10 %
}

// ---------------------------------------------------------------------------
// 1. Create Accounts Payable journal entry
// ---------------------------------------------------------------------------

async function createAPJournalEntry(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  bill: {
    id: string;
    billNo: string;
    billDate: Date;
    totalCost: unknown; // Prisma Decimal
    lines: Array<{
      amountExVat: unknown;
      vatAmount: unknown;
      amountIncVat: unknown;
      lineTotal: unknown;
      vatRate: unknown;
    }>;
  }
): Promise<string | null> {
  // Calculate net and VAT from bill lines if available, else derive from totalCost
  let netTotal = 0;
  let vatTotal = 0;

  const billTotal = Number(bill.totalCost);

  const linesHaveVatBreakdown = bill.lines.some(
    (l) => l.amountExVat != null || l.vatAmount != null
  );

  if (linesHaveVatBreakdown) {
    for (const line of bill.lines) {
      const lineNet =
        line.amountExVat != null
          ? Number(line.amountExVat)
          : Number(line.lineTotal);
      const lineVat =
        line.vatAmount != null ? Number(line.vatAmount) : 0;
      netTotal += lineNet;
      vatTotal += lineVat;
    }
  } else {
    // Assume totalCost is gross including 20% VAT
    // But many supplier bills record totalCost as net — use the convention
    // that totalCost IS net. VAT = 20% of net. Gross = net * 1.2
    netTotal = billTotal;
    vatTotal = Math.round(billTotal * 0.2 * 100) / 100;
  }

  const grossTotal =
    Math.round((netTotal + vatTotal) * 100) / 100;

  // Look up chart of accounts
  const [materialsAccount, vatInputAccount, tradeCreditorsAccount] =
    await Promise.all([
      tx.chartOfAccount.findFirst({ where: { accountCode: "5000" } }),
      tx.chartOfAccount.findFirst({ where: { accountCode: "1300" } }),
      tx.chartOfAccount.findFirst({ where: { accountCode: "2000" } }),
    ]);

  if (!materialsAccount || !vatInputAccount || !tradeCreditorsAccount) {
    // Cannot create journal if accounts missing — log but don't fail
    console.warn(
      `[bill-processor] Missing chart accounts for AP journal. ` +
        `5000=${!!materialsAccount} 1300=${!!vatInputAccount} 2000=${!!tradeCreditorsAccount}`
    );
    return null;
  }

  const journalEntry = await tx.journalEntry.create({
    data: {
      entryDate: bill.billDate,
      reference: bill.billNo,
      description: `Supplier bill ${bill.billNo} — AP entry`,
      sourceType: "SUPPLIER_BILL",
      sourceId: bill.id,
      status: "POSTED",
      lines: {
        create: [
          {
            accountId: materialsAccount.id,
            description: `Materials — bill ${bill.billNo}`,
            debit: netTotal,
            credit: 0,
          },
          {
            accountId: vatInputAccount.id,
            description: `VAT input — bill ${bill.billNo}`,
            debit: vatTotal,
            credit: 0,
          },
          {
            accountId: tradeCreditorsAccount.id,
            description: `Trade creditors — bill ${bill.billNo}`,
            debit: 0,
            credit: grossTotal,
          },
        ],
      },
    },
  });

  // Update account balances
  await Promise.all([
    tx.chartOfAccount.update({
      where: { id: materialsAccount.id },
      data: {
        currentBalance: { increment: netTotal },
      },
    }),
    tx.chartOfAccount.update({
      where: { id: vatInputAccount.id },
      data: {
        currentBalance: { increment: vatTotal },
      },
    }),
    tx.chartOfAccount.update({
      where: { id: tradeCreditorsAccount.id },
      data: {
        currentBalance: { increment: grossTotal },
      },
    }),
  ]);

  return journalEntry.id;
}

// ---------------------------------------------------------------------------
// 2. Matching strategies
// ---------------------------------------------------------------------------

type BillLineRow = {
  id: string;
  description: string;
  normalizedItemName: string | null;
  productCode: string | null;
  qty: unknown; // Prisma Decimal
  unitCost: unknown;
  lineTotal: unknown;
  allocationStatus: AllocationStatus;
};

type TicketLineCandidate = {
  id: string;
  ticketId: string;
  description: string;
  normalizedItemName: string | null;
  productCode: string | null;
  qty: unknown;
  supplierName: string | null;
  supplierId: string | null;
  expectedCostUnit: unknown;
  actualCostTotal: unknown;
  status: string;
  siteId: string | null;
  payingCustomerId: string;
  ticket: {
    siteId: string | null;
    payingCustomerId: string;
  };
};

/** Strategy A — PO reference match */
async function matchViaPO(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  billSupplierId: string,
  billCustomerRef: string | null,
  billSiteRef: string | null,
  billLines: BillLineRow[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  // Build lookup refs from the bill
  const refs = [billCustomerRef, billSiteRef].filter(Boolean) as string[];
  if (refs.length === 0) return results;

  // Find procurement orders for this supplier with matching refs
  const poOrders = await tx.procurementOrder.findMany({
    where: {
      supplierId: billSupplierId,
      OR: [
        { poNo: { in: refs } },
        { supplierRef: { in: refs } },
        { siteRef: { in: refs } },
      ],
    },
    include: {
      lines: {
        where: { ticketLineId: { not: null } },
        include: { ticketLine: true },
      },
    },
  });

  if (poOrders.length === 0) return results;

  // Build a map of PO-line ticketLineId -> PO line details
  const poLineMap = new Map<
    string,
    { description: string; qty: number; unitCost: number; ticketLineId: string }
  >();
  for (const po of poOrders) {
    for (const pl of po.lines) {
      if (pl.ticketLineId) {
        poLineMap.set(pl.ticketLineId, {
          description: pl.description,
          qty: Number(pl.qty),
          unitCost: Number(pl.unitCost),
          ticketLineId: pl.ticketLineId,
        });
      }
    }
  }

  // For each bill line, try to match to a PO line by description or qty
  for (const bl of billLines) {
    if (bl.allocationStatus === "MATCHED") continue;

    const blTokens = tokenize(bl.description);
    let bestMatch: { ticketLineId: string; confidence: number } | null = null;

    for (const [ticketLineId, plInfo] of poLineMap) {
      const plTokens = tokenize(plInfo.description);
      const overlap = tokenOverlap(blTokens, plTokens);
      const qtyMatch = qtyCloseEnough(Number(bl.qty), plInfo.qty);

      // Need either strong text overlap or exact qty + some text overlap
      let confidence = 0;
      if (overlap >= 0.6 && qtyMatch) {
        confidence = 0.95;
      } else if (overlap >= 0.6) {
        confidence = 0.8;
      } else if (qtyMatch && overlap >= 0.3) {
        confidence = 0.7;
      }

      if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
        bestMatch = { ticketLineId, confidence };
      }
    }

    if (bestMatch) {
      results.push({
        billLineId: bl.id,
        ticketLineId: bestMatch.ticketLineId,
        strategy: "PO_REFERENCE",
        confidence: bestMatch.confidence,
        matchedQty: Number(bl.qty),
        matchedUnitCost: Number(bl.unitCost),
        matchedTotal: Number(bl.lineTotal),
      });
      // Remove from map so it's not double-matched
      poLineMap.delete(bestMatch.ticketLineId);
    }
  }

  return results;
}

/** Strategy B — Description + Supplier match */
async function matchViaDescriptionSupplier(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  billSupplierId: string,
  supplierName: string,
  unmatchedBillLines: BillLineRow[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  if (unmatchedBillLines.length === 0) return results;

  // Find ticket lines for this supplier that are not yet fully costed
  const ticketLines = await tx.ticketLine.findMany({
    where: {
      OR: [
        { supplierId: billSupplierId },
        { supplierName: { contains: supplierName, mode: "insensitive" } },
      ],
      status: {
        notIn: ["FULLY_COSTED", "INVOICED", "MERGED"],
      },
    },
    include: {
      ticket: { select: { siteId: true, payingCustomerId: true } },
      costAllocations: { select: { totalCost: true } },
    },
  });

  if (ticketLines.length === 0) return results;

  const usedTicketLineIds = new Set<string>();

  for (const bl of unmatchedBillLines) {
    const blTokens = tokenize(bl.description);
    let bestMatch: {
      ticketLine: (typeof ticketLines)[number];
      confidence: number;
    } | null = null;

    for (const tl of ticketLines) {
      if (usedTicketLineIds.has(tl.id)) continue;

      // Check if already has a cost allocation for the same amount
      const existingTotal = tl.costAllocations.reduce(
        (sum, ca) => sum + Number(ca.totalCost),
        0
      );
      if (
        existingTotal > 0 &&
        Math.abs(existingTotal - Number(bl.lineTotal)) < 0.01
      ) {
        continue; // same amount already allocated
      }

      const tlTokens = tokenize(
        tl.normalizedItemName || tl.description
      );
      const overlap = tokenOverlap(blTokens, tlTokens);
      if (overlap < 0.6) continue;

      const qtyMatch = qtyCloseEnough(Number(bl.qty), Number(tl.qty));

      let confidence = overlap * 0.7; // base from text
      if (qtyMatch) confidence += 0.25;
      if (tl.supplierId === billSupplierId) confidence += 0.05;

      confidence = Math.min(confidence, 1);

      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = { ticketLine: tl, confidence };
      }
    }

    if (bestMatch && bestMatch.confidence >= 0.6) {
      usedTicketLineIds.add(bestMatch.ticketLine.id);
      results.push({
        billLineId: bl.id,
        ticketLineId: bestMatch.ticketLine.id,
        strategy: "DESCRIPTION_SUPPLIER",
        confidence: bestMatch.confidence,
        matchedQty: Number(bl.qty),
        matchedUnitCost: Number(bl.unitCost),
        matchedTotal: Number(bl.lineTotal),
      });
    }
  }

  return results;
}

/** Strategy C — Product code match */
async function matchViaProductCode(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  billSupplierId: string,
  unmatchedBillLines: BillLineRow[]
): Promise<MatchResult[]> {
  const results: MatchResult[] = [];

  // Only lines that have a product code
  const linesWithCode = unmatchedBillLines.filter(
    (l) => l.productCode && l.productCode.trim().length > 0
  );
  if (linesWithCode.length === 0) return results;

  const codes = linesWithCode.map((l) => l.productCode!.trim());

  // Find ticket lines by product code or description containing the code
  const ticketLines = await tx.ticketLine.findMany({
    where: {
      OR: [
        { productCode: { in: codes } },
        ...codes.map((code) => ({
          description: { contains: code, mode: "insensitive" as const },
        })),
      ],
      status: { notIn: ["FULLY_COSTED", "INVOICED", "MERGED"] },
    },
    include: {
      ticket: { select: { siteId: true, payingCustomerId: true } },
      costAllocations: { select: { totalCost: true } },
    },
  });

  if (ticketLines.length === 0) return results;

  const usedTicketLineIds = new Set<string>();

  for (const bl of linesWithCode) {
    const code = bl.productCode!.trim();

    for (const tl of ticketLines) {
      if (usedTicketLineIds.has(tl.id)) continue;

      const codeMatch =
        tl.productCode?.trim() === code ||
        tl.description.toUpperCase().includes(code.toUpperCase());

      if (!codeMatch) continue;

      // Skip if same amount already allocated
      const existingTotal = tl.costAllocations.reduce(
        (sum, ca) => sum + Number(ca.totalCost),
        0
      );
      if (
        existingTotal > 0 &&
        Math.abs(existingTotal - Number(bl.lineTotal)) < 0.01
      ) {
        continue;
      }

      const qtyMatch = qtyCloseEnough(Number(bl.qty), Number(tl.qty));
      let confidence = 0.75; // base for code match
      if (qtyMatch) confidence += 0.15;
      if (tl.productCode?.trim() === code) confidence += 0.1;
      confidence = Math.min(confidence, 1);

      usedTicketLineIds.add(tl.id);
      results.push({
        billLineId: bl.id,
        ticketLineId: tl.id,
        strategy: "PRODUCT_CODE",
        confidence,
        matchedQty: Number(bl.qty),
        matchedUnitCost: Number(bl.unitCost),
        matchedTotal: Number(bl.lineTotal),
      });
      break; // found a match for this bill line
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3 & 4. Create cost allocations + link site/customer
// ---------------------------------------------------------------------------

async function applyMatches(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  billSupplierId: string,
  matches: MatchResult[]
): Promise<void> {
  for (const m of matches) {
    // Create cost allocation
    await tx.costAllocation.create({
      data: {
        ticketLineId: m.ticketLineId,
        supplierBillLineId: m.billLineId,
        supplierId: billSupplierId,
        qtyAllocated: m.matchedQty,
        unitCost: m.matchedUnitCost,
        totalCost: m.matchedTotal,
        allocationStatus: "MATCHED",
        confidenceScore: m.confidence,
        notes: `Auto-matched via ${m.strategy} (confidence ${(m.confidence * 100).toFixed(0)}%)`,
      },
    });

    // Update bill line allocationStatus + link to ticket/site/customer
    const ticketLine = await tx.ticketLine.findUnique({
      where: { id: m.ticketLineId },
      include: {
        ticket: {
          select: { id: true, siteId: true, payingCustomerId: true },
        },
      },
    });

    if (ticketLine) {
      await tx.supplierBillLine.update({
        where: { id: m.billLineId },
        data: {
          allocationStatus: "MATCHED",
          ticketId: ticketLine.ticket.id,
          siteId: ticketLine.ticket.siteId,
          customerId: ticketLine.ticket.payingCustomerId,
        },
      });

      // Update ticket line actual cost and status
      // Sum all cost allocations for this ticket line
      const allAllocations = await tx.costAllocation.findMany({
        where: { ticketLineId: m.ticketLineId },
        select: { totalCost: true },
      });
      const totalAllocatedCost = allAllocations.reduce(
        (sum, ca) => sum + Number(ca.totalCost),
        0
      );

      await tx.ticketLine.update({
        where: { id: m.ticketLineId },
        data: {
          actualCostTotal: totalAllocatedCost,
          status: "FULLY_COSTED",
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function processBill(
  billId: string
): Promise<ProcessingResult> {
  const errors: string[] = [];
  let journalEntryId: string | null = null;
  let allMatches: MatchResult[] = [];

  // Load the bill with all relations
  const bill = await prisma.supplierBill.findUnique({
    where: { id: billId },
    include: {
      supplier: true,
      lines: {
        include: {
          costAllocations: true,
        },
      },
    },
  });

  if (!bill) {
    return {
      billId,
      journalEntryId: null,
      matchSummary: { totalLines: 0, matched: 0, partial: 0, unallocated: 0 },
      matches: [],
      errors: [`Bill ${billId} not found`],
    };
  }

  // ----- Step 1: Create AP journal entry (transactional) -----
  try {
    journalEntryId = await prisma.$transaction(async (tx) => {
      return createAPJournalEntry(tx, bill);
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown journal error";
    errors.push(`Journal entry creation failed: ${msg}`);
    console.error("[bill-processor] Journal entry error:", err);
  }

  // ----- Steps 2-4: Matching + cost allocations (transactional) -----
  try {
    allMatches = await prisma.$transaction(async (tx) => {
      const billLines: BillLineRow[] = bill.lines.map((l) => ({
        id: l.id,
        description: l.description,
        normalizedItemName: l.normalizedItemName,
        productCode: l.productCode,
        qty: l.qty,
        unitCost: l.unitCost,
        lineTotal: l.lineTotal,
        allocationStatus: l.allocationStatus,
      }));

      // Skip lines already matched
      const unmatchedLines = billLines.filter(
        (l) => l.allocationStatus !== "MATCHED"
      );

      if (unmatchedLines.length === 0) {
        return [];
      }

      // Strategy A: PO reference match
      const poMatches = await matchViaPO(
        tx,
        bill.supplierId,
        bill.customerRef,
        bill.siteRef,
        unmatchedLines
      );

      const matchedByPO = new Set(poMatches.map((m) => m.billLineId));
      const afterPO = unmatchedLines.filter(
        (l) => !matchedByPO.has(l.id)
      );

      // Strategy B: Description + supplier match
      const descMatches = await matchViaDescriptionSupplier(
        tx,
        bill.supplierId,
        bill.supplier.name,
        afterPO
      );

      const matchedByDesc = new Set(descMatches.map((m) => m.billLineId));
      const afterDesc = afterPO.filter(
        (l) => !matchedByDesc.has(l.id)
      );

      // Strategy C: Product code match
      const codeMatches = await matchViaProductCode(
        tx,
        bill.supplierId,
        afterDesc
      );

      const combined = [...poMatches, ...descMatches, ...codeMatches];

      // Apply all matches — create allocations, link site/customer, update statuses
      await applyMatches(tx, bill.supplierId, combined);

      // Mark remaining unmatched bill lines explicitly
      const matchedBillLineIds = new Set(
        combined.map((m) => m.billLineId)
      );
      for (const bl of unmatchedLines) {
        if (!matchedBillLineIds.has(bl.id)) {
          await tx.supplierBillLine.update({
            where: { id: bl.id },
            data: { allocationStatus: "UNALLOCATED" },
          });
        }
      }

      // Update bill-level status
      const totalLines = bill.lines.length;
      const matchedCount = combined.length;
      const alreadyMatched = bill.lines.filter(
        (l) => l.allocationStatus === "MATCHED"
      ).length;
      const totalMatched = matchedCount + alreadyMatched;

      let billStatus: string;
      if (totalMatched >= totalLines) {
        billStatus = "MATCHED";
      } else if (totalMatched > 0) {
        billStatus = "PARTIAL";
      } else {
        billStatus = "PENDING";
      }

      await tx.supplierBill.update({
        where: { id: bill.id },
        data: { status: billStatus },
      });

      return combined;
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unknown matching error";
    errors.push(`Matching failed: ${msg}`);
    console.error("[bill-processor] Matching error:", err);
  }

  // ----- Build summary -----
  // Re-read final line statuses
  const finalLines = await prisma.supplierBillLine.findMany({
    where: { supplierBillId: billId },
    select: { allocationStatus: true },
  });

  const matched = finalLines.filter(
    (l) => l.allocationStatus === "MATCHED"
  ).length;
  const partial = finalLines.filter(
    (l) => l.allocationStatus === "PARTIAL"
  ).length;
  const unallocated = finalLines.filter(
    (l) => l.allocationStatus === "UNALLOCATED"
  ).length;

  return {
    billId,
    journalEntryId,
    matchSummary: {
      totalLines: finalLines.length,
      matched,
      partial,
      unallocated,
    },
    matches: allMatches,
    errors,
  };
}

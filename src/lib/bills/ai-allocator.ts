/**
 * AI auto-allocator for SupplierBillLines.
 *
 * Replaces the data-admin job of picking 3 fields per line:
 *   1. costClassification — BILLABLE / ABSORBED / STOCK / MOQ_EXCESS / ...
 *   2. vatRate + vatStatus — defaults 20 / STANDARD; overridden on keyword hits
 *   3. ticketId            — copied from the match-engine's AUTO_LINKED row
 *
 * Heuristics only — no LLM call. Description-string regex is good enough for
 * (1) and (2). For (3) we delegate to the existing matchBillLine engine
 * (src/lib/intake/match-engine.ts) which already runs the multi-signal scoring
 * and writes BillLineMatch audit rows. We just promote AUTO_LINKED ticket
 * matches onto SupplierBillLine.ticketId.
 *
 * Note: `accountCategory` is referenced in the spec but does NOT exist on
 * SupplierBillLine. Reported as a schema gap; not written.
 */

import { prisma } from "@/lib/prisma";
import { matchBillLine } from "@/lib/intake/match-engine";
import type { CostClassification } from "@/generated/prisma";

export interface AllocatorResult {
  linesProcessed: number;
  ticketsLinked: number;
  suggestionsCreated: number;
  errors: string[];
}

const ABSORBED_PATTERNS = [
  /\bstationery\b/i,
  /\bpostage\b/i,
  /\binsurance\b/i,
  /\butilit(y|ies)\b/i,
  /\belectricity\b/i,
  /\bwater\s+rates?\b/i,
  /\bgas\s+(supply|charge)\b/i,
  /\bphone\s+bill\b/i,
  /\bbroadband\b/i,
  /\binternet\b/i,
];

const ZERO_RATED_PATTERNS = [/zero[\s-]?rated/i, /\b0\s*%/];
const REVERSE_CHARGE_PATTERNS = [/reverse[\s-]?charge/i, /\bCIS\b/];

// GL bucket keyword routing. Bills only post to 4 GL accounts:
// 5000 Materials (default 80%) / 5100 Labour / 5200 Carriage In / 5400 Plant Hire.
const LOGISTICS_PATTERNS = [/\bdelivery\b/i, /\bcarriage\b/i, /\bfreight\b/i, /\bshipping\b/i, /\bhaulage\b/i];
const LABOUR_PATTERNS = [/\blabour\b/i, /\blabor\b/i, /\binstall(ation)?\b/i, /\bservice\s+charge\b/i, /\bsubcontract/i];
const PLANT_HIRE_PATTERNS = [/\bhire\b/i, /\brental\b/i, /\bscaffold/i, /\bskip\b/i, /\bplant\b/i];

function classifyCost(description: string): CostClassification {
  if (ABSORBED_PATTERNS.some((p) => p.test(description))) return "ABSORBED";
  return "BILLABLE";
}

function pickGlAccountCode(description: string): "5000" | "5100" | "5200" | "5400" {
  if (LOGISTICS_PATTERNS.some((p) => p.test(description))) return "5200";
  if (LABOUR_PATTERNS.some((p) => p.test(description))) return "5100";
  if (PLANT_HIRE_PATTERNS.some((p) => p.test(description))) return "5400";
  return "5000";
}

function deriveVat(description: string): { vatRate: number; vatStatus: string } {
  if (ZERO_RATED_PATTERNS.some((p) => p.test(description))) {
    return { vatRate: 0, vatStatus: "ZERO_RATED" };
  }
  if (REVERSE_CHARGE_PATTERNS.some((p) => p.test(description))) {
    return { vatRate: 0, vatStatus: "REVERSE_CHARGE" };
  }
  return { vatRate: 20, vatStatus: "STANDARD" };
}

export async function allocateBillLines(billId: string): Promise<AllocatorResult> {
  const result: AllocatorResult = {
    linesProcessed: 0,
    ticketsLinked: 0,
    suggestionsCreated: 0,
    errors: [],
  };

  const bill = await prisma.supplierBill.findUnique({
    where: { id: billId },
    select: { id: true },
  });
  if (!bill) {
    result.errors.push(`SupplierBill ${billId} not found`);
    return result;
  }

  // Resolve the 4 GL bucket IDs once. Avoids per-line DB hit.
  const glRows = await prisma.chartOfAccount.findMany({
    where: { accountCode: { in: ["5000", "5100", "5200", "5400"] } },
    select: { id: true, accountCode: true },
  });
  const glIdByCode: Record<string, string> = {};
  for (const r of glRows) glIdByCode[r.accountCode] = r.id;

  const lines = await prisma.supplierBillLine.findMany({
    where: { supplierBillId: billId },
    select: { id: true, description: true, ticketId: true, vatRate: true, glAccountId: true },
  });

  for (const line of lines) {
    try {
      const cost = classifyCost(line.description);
      const vat = deriveVat(line.description);
      const glCode = pickGlAccountCode(line.description);
      const glAccountId = glIdByCode[glCode] ?? null;

      await prisma.supplierBillLine.update({
        where: { id: line.id },
        data: {
          costClassification: cost,
          vatRate: vat.vatRate,
          vatStatus: vat.vatStatus,
          // Default to the keyword-routed GL bucket. Never overwrite a
          // user-confirmed choice that already differs from null.
          ...(line.glAccountId == null && glAccountId ? { glAccountId } : {}),
        },
      });

      // Ticket linking — only run match engine if no BillLineMatch rows yet
      // exist for this line. Avoids re-running the heavy scorer when the
      // pipeline already invoked it.
      let matches = await prisma.billLineMatch.findMany({
        where: { supplierBillLineId: line.id },
        orderBy: { overallConfidence: "desc" },
      });

      if (matches.length === 0) {
        await matchBillLine(line.id);
        matches = await prisma.billLineMatch.findMany({
          where: { supplierBillLineId: line.id },
          orderBy: { overallConfidence: "desc" },
        });
      }

      // Promote AUTO_LINKED ticket-line match onto SupplierBillLine.ticketId
      const auto = matches.find(
        (m) => m.action === "AUTO_LINKED" && m.candidateType === "TICKET_LINE",
      );
      if (auto && !line.ticketId) {
        const tl = await prisma.ticketLine.findUnique({
          where: { id: auto.candidateId },
          select: { ticketId: true, ticket: { select: { status: true } } },
        });
        // Status filter: don't auto-link onto closed/locked/invoiced tickets
        const closedStatuses = new Set(["INVOICED", "LOCKED", "CLOSED"]);
        if (tl && !closedStatuses.has(tl.ticket?.status ?? "")) {
          await prisma.supplierBillLine.update({
            where: { id: line.id },
            data: { ticketId: tl.ticketId },
          });
          result.ticketsLinked += 1;
        }
      } else if (matches.some((m) => m.action === "SUGGESTED")) {
        result.suggestionsCreated += 1;
      }

      result.linesProcessed += 1;
    } catch (e) {
      result.errors.push(
        `line ${line.id}: ${e instanceof Error ? e.message : "unknown"}`,
      );
    }
  }

  return result;
}

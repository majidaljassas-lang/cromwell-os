// Bank transaction reconciliation matcher.
//
// For each UNRECONCILED BankTransaction:
//   - DEPOSITS  -> candidate SalesInvoices (status not in PAID/VOID)
//   - WITHDRAWALS -> candidate SupplierBills (paymentStatus != PAID)
//
// Scoring (0-100):
//   amount  : exact = 60, ±£0.50 = 50, ±2% = 35, otherwise 0  (fail-fast: no amount match → skip)
//   date    : ≤7d = 25, ≤30d = 15, ≤60d = 5
//   ref     : exact invoice/bill ref in description = 15, fuzzy customer/supplier name = 10
//
// ≥80 -> "Best Match", 50-79 -> "Possible Match", <50 dropped.
// Output written to BankTransactionMatch (idempotent on (txn, type, record)).

import { prisma } from "@/lib/prisma";

const BEST_THRESHOLD = 80;
const POSSIBLE_THRESHOLD = 50;
const CANDIDATE_DATE_WINDOW_DAYS = 60;
const AMOUNT_TOLERANCE_PCT = 0.02;
const ABSOLUTE_AMOUNT_TOLERANCE = 0.5;

interface MatchSummary {
  transactionsProcessed: number;
  candidatesCreated: number;
  bestMatches: number;
  possibleMatches: number;
}

export async function runMatcher(opts?: {
  bankAccountId?: string;
  transactionId?: string;
  limit?: number;
}): Promise<MatchSummary> {
  const summary: MatchSummary = {
    transactionsProcessed: 0,
    candidatesCreated: 0,
    bestMatches: 0,
    possibleMatches: 0,
  };

  const where: {
    reconciliationStatus: string;
    bankAccountId?: string;
    id?: string;
  } = { reconciliationStatus: "UNRECONCILED" };
  if (opts?.bankAccountId) where.bankAccountId = opts.bankAccountId;
  if (opts?.transactionId) where.id = opts.transactionId;

  const txns = await prisma.bankTransaction.findMany({
    where,
    take: opts?.limit ?? 500,
    orderBy: { transactionDate: "desc" },
  });

  for (const tx of txns) {
    summary.transactionsProcessed++;
    const amount = Number(tx.amount);
    if (amount === 0) continue;

    const isDeposit = amount > 0;
    const candidates = isDeposit
      ? await scoreInvoices(tx.id, Math.abs(amount), tx.transactionDate, tx.description, tx.reference)
      : await scoreBills(tx.id, Math.abs(amount), tx.transactionDate, tx.description, tx.reference);

    for (const c of candidates) {
      if (c.score < POSSIBLE_THRESHOLD) continue;
      const matchType = isDeposit ? "INVOICE" : "BILL";

      await prisma.bankTransactionMatch.upsert({
        where: {
          bankTransactionId_matchType_matchedRecordId: {
            bankTransactionId: tx.id,
            matchType,
            matchedRecordId: c.id,
          },
        },
        update: {
          confidenceScore: c.score,
          matchedRecordRef: c.ref,
        },
        create: {
          bankTransactionId: tx.id,
          matchType,
          matchedRecordId: c.id,
          matchedRecordRef: c.ref,
          confidenceScore: c.score,
        },
      });

      summary.candidatesCreated++;
      if (c.score >= BEST_THRESHOLD) summary.bestMatches++;
      else summary.possibleMatches++;
    }
  }

  return summary;
}

interface ScoredCandidate {
  id: string;
  ref: string | null;
  score: number;
}

async function scoreInvoices(
  _txnId: string,
  txAmount: number,
  txDate: Date,
  description: string,
  reference: string | null,
): Promise<ScoredCandidate[]> {
  const fromDate = addDays(txDate, -CANDIDATE_DATE_WINDOW_DAYS);
  const toDate = addDays(txDate, CANDIDATE_DATE_WINDOW_DAYS);

  const invoices = await prisma.salesInvoice.findMany({
    where: {
      status: { notIn: ["VOID", "CANCELLED"] },
      paidAt: null,
      issuedAt: { gte: fromDate, lte: toDate },
      totalGross: {
        gte: txAmount * (1 - AMOUNT_TOLERANCE_PCT) - ABSOLUTE_AMOUNT_TOLERANCE,
        lte: txAmount * (1 + AMOUNT_TOLERANCE_PCT) + ABSOLUTE_AMOUNT_TOLERANCE,
      },
    },
    take: 50,
    select: {
      id: true,
      invoiceNo: true,
      totalGross: true,
      issuedAt: true,
      customer: { select: { name: true } },
    },
  });

  const haystack = `${description} ${reference ?? ""}`.toLowerCase();
  const out: ScoredCandidate[] = [];
  for (const inv of invoices) {
    const score = scoreOne({
      txAmount,
      txDate,
      candidateAmount: Number(inv.totalGross),
      candidateDate: inv.issuedAt ?? txDate,
      candidateRef: inv.invoiceNo ?? "",
      candidateName: inv.customer?.name ?? "",
      haystack,
    });
    out.push({ id: inv.id, ref: inv.invoiceNo, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function scoreBills(
  _txnId: string,
  txAmount: number,
  txDate: Date,
  description: string,
  reference: string | null,
): Promise<ScoredCandidate[]> {
  const fromDate = addDays(txDate, -CANDIDATE_DATE_WINDOW_DAYS);
  const toDate = addDays(txDate, CANDIDATE_DATE_WINDOW_DAYS);

  const bills = await prisma.supplierBill.findMany({
    where: {
      paymentStatus: { not: "PAID" },
      billDate: { gte: fromDate, lte: toDate },
      totalCost: {
        gte: txAmount * (1 - AMOUNT_TOLERANCE_PCT) - ABSOLUTE_AMOUNT_TOLERANCE,
        lte: txAmount * (1 + AMOUNT_TOLERANCE_PCT) + ABSOLUTE_AMOUNT_TOLERANCE,
      },
    },
    take: 50,
    select: {
      id: true,
      billNo: true,
      totalCost: true,
      billDate: true,
      supplier: { select: { name: true } },
    },
  });

  const haystack = `${description} ${reference ?? ""}`.toLowerCase();
  const out: ScoredCandidate[] = [];
  for (const bill of bills) {
    const score = scoreOne({
      txAmount,
      txDate,
      candidateAmount: Number(bill.totalCost),
      candidateDate: bill.billDate,
      candidateRef: bill.billNo,
      candidateName: bill.supplier?.name ?? "",
      haystack,
    });
    out.push({ id: bill.id, ref: bill.billNo, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

function scoreOne(args: {
  txAmount: number;
  txDate: Date;
  candidateAmount: number;
  candidateDate: Date;
  candidateRef: string;
  candidateName: string;
  haystack: string;
}): number {
  let score = 0;

  // Amount score
  const diff = Math.abs(args.txAmount - args.candidateAmount);
  if (diff < 0.005) score += 60;
  else if (diff <= ABSOLUTE_AMOUNT_TOLERANCE) score += 50;
  else if (diff / args.candidateAmount <= AMOUNT_TOLERANCE_PCT) score += 35;
  else return 0; // fail-fast

  // Date score
  const dayDelta = Math.abs(daysBetween(args.txDate, args.candidateDate));
  if (dayDelta <= 7) score += 25;
  else if (dayDelta <= 30) score += 15;
  else if (dayDelta <= 60) score += 5;

  // Reference score
  if (args.candidateRef && args.haystack.includes(args.candidateRef.toLowerCase())) {
    score += 15;
  } else if (args.candidateName) {
    const tokens = args.candidateName
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    const hits = tokens.filter((t) => args.haystack.includes(t)).length;
    if (hits >= 2) score += 10;
    else if (hits === 1) score += 5;
  }

  return Math.min(100, score);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / 86400000;
}

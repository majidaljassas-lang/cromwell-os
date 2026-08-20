import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MatchCandidate {
  type: "PAYMENT_RECEIVED" | "SUPPLIER_BILL";
  entityId: string;
  entityRef: string; // invoice number, bill number, etc.
  amount: number;
  date: Date;
  confidence: number;
  matchReason: string;
}

interface ReconciliationEntry {
  transactionId: string;
  description: string;
  amount: number;
  status: "RECONCILED" | "MATCHED" | "UNRECONCILED";
  match?: MatchCandidate;
}

export interface ReconciliationResult {
  bankAccountId: string;
  processed: number;
  reconciled: number;
  matched: number;
  unreconciled: number;
  entries: ReconciliationEntry[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract invoice numbers like INV-001, INV001, etc. from text */
function extractInvoiceNumbers(text: string): string[] {
  const matches = text.match(/INV[-\s]?\d+/gi) || [];
  return matches.map((m) => m.replace(/\s/g, "").toUpperCase());
}

/** Extract bill numbers from text */
function extractBillNumbers(text: string): string[] {
  const matches = text.match(/BILL[-\s]?\d+/gi) || [];
  return matches.map((m) => m.replace(/\s/g, "").toUpperCase());
}

/** Check if a name appears in the description (case-insensitive) */
function nameInDescription(name: string, description: string): boolean {
  if (!name || name.length < 3) return false;
  return description.toLowerCase().includes(name.toLowerCase());
}

/** Days between two dates */
function daysBetween(a: Date, b: Date): number {
  return Math.abs(Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Score date proximity: 1.0 for same day, decreasing to 0 at 30+ days */
function dateProximityScore(a: Date, b: Date): number {
  const days = daysBetween(a, b);
  if (days > 30) return 0;
  return 1 - days / 30;
}

// ---------------------------------------------------------------------------
// Reconciliation Engine
// ---------------------------------------------------------------------------

export async function reconcileBankTransactions(
  bankAccountId: string
): Promise<ReconciliationResult> {
  const errors: string[] = [];
  const entries: ReconciliationEntry[] = [];

  // Fetch unreconciled transactions
  const transactions = await prisma.bankTransaction.findMany({
    where: {
      bankAccountId,
      reconciliationStatus: "UNRECONCILED",
    },
    orderBy: { transactionDate: "asc" },
  });

  if (transactions.length === 0) {
    return {
      bankAccountId,
      processed: 0,
      reconciled: 0,
      matched: 0,
      unreconciled: 0,
      entries: [],
      errors: [],
    };
  }

  // Preload reference data for matching
  const [unpaidInvoices, unpaidBills, customers, suppliers] = await Promise.all([
    prisma.salesInvoice.findMany({
      where: { status: { in: ["ISSUED", "SENT", "OVERDUE"] } },
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.supplierBill.findMany({
      where: { status: { in: ["RECEIVED", "APPROVED", "OVERDUE"] } },
      include: { supplier: { select: { id: true, name: true } } },
    }),
    prisma.customer.findMany({ select: { id: true, name: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
  ]);

  let reconciled = 0;
  let matched = 0;
  let unreconciled = 0;

  for (const txn of transactions) {
    const amt = Number(txn.amount);
    const desc = txn.description || "";
    const txnDate = txn.transactionDate;
    const isIncoming = amt > 0;

    try {
      let bestMatch: MatchCandidate | null = null;

      if (isIncoming) {
        // Money IN: match against customer payments / sales invoices
        bestMatch = matchIncomingTransaction(
          amt,
          desc,
          txnDate,
          unpaidInvoices,
          customers
        );
      } else {
        // Money OUT: match against supplier bills
        bestMatch = matchOutgoingTransaction(
          Math.abs(amt),
          desc,
          txnDate,
          unpaidBills,
          suppliers
        );
      }

      if (bestMatch && bestMatch.confidence >= 0.8) {
        // High confidence: auto-reconcile
        await applyReconciliation(txn.id, bestMatch, bankAccountId);
        reconciled++;
        entries.push({
          transactionId: txn.id,
          description: desc,
          amount: amt,
          status: "RECONCILED",
          match: bestMatch,
        });
      } else if (bestMatch && bestMatch.confidence >= 0.4) {
        // Medium confidence: suggest match
        await prisma.bankTransaction.update({
          where: { id: txn.id },
          data: {
            reconciliationStatus: "MATCHED",
            notes: `Suggested match: ${bestMatch.type} ${bestMatch.entityRef} (${Math.round(bestMatch.confidence * 100)}% confidence - ${bestMatch.matchReason})`,
          },
        });
        matched++;
        entries.push({
          transactionId: txn.id,
          description: desc,
          amount: amt,
          status: "MATCHED",
          match: bestMatch,
        });
      } else {
        unreconciled++;
        entries.push({
          transactionId: txn.id,
          description: desc,
          amount: amt,
          status: "UNRECONCILED",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Transaction ${txn.id}: ${msg}`);
      unreconciled++;
      entries.push({
        transactionId: txn.id,
        description: desc,
        amount: amt,
        status: "UNRECONCILED",
      });
    }
  }

  return {
    bankAccountId,
    processed: transactions.length,
    reconciled,
    matched,
    unreconciled,
    entries,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Matching: Incoming (money IN -> customer payments)
// ---------------------------------------------------------------------------

function matchIncomingTransaction(
  amount: number,
  description: string,
  txnDate: Date,
  unpaidInvoices: Array<{
    id: string;
    invoiceNo: string | null;
    totalSell: unknown;
    issuedAt: Date | null;
    customer: { id: string; name: string };
  }>,
  customers: Array<{ id: string; name: string }>
): MatchCandidate | null {
  let best: MatchCandidate | null = null;

  // Extract invoice numbers from description
  const invoiceRefs = extractInvoiceNumbers(description);

  for (const inv of unpaidInvoices) {
    let confidence = 0;
    const reasons: string[] = [];
    const invAmount = Number(inv.totalSell);
    const invDate = inv.issuedAt || new Date();

    // 1. Exact amount match
    if (Math.abs(invAmount - amount) < 0.01) {
      confidence += 0.5;
      reasons.push("exact amount");
    } else if (Math.abs(invAmount - amount) / Math.max(invAmount, 1) < 0.02) {
      // Within 2% — might be rounding or partial payment
      confidence += 0.2;
      reasons.push("close amount");
    } else {
      continue; // Skip if amounts don't match at all
    }

    // 2. Invoice number in description
    if (inv.invoiceNo && invoiceRefs.includes(inv.invoiceNo.replace(/\s/g, "").toUpperCase())) {
      confidence += 0.35;
      reasons.push("invoice ref in description");
    }

    // 3. Customer name in description
    if (nameInDescription(inv.customer.name, description)) {
      confidence += 0.15;
      reasons.push("customer name match");
    }

    // 4. Date proximity
    const dateScore = dateProximityScore(txnDate, invDate);
    confidence += dateScore * 0.1;
    if (dateScore > 0.5) {
      reasons.push("date proximity");
    }

    if (confidence > (best?.confidence || 0)) {
      best = {
        type: "PAYMENT_RECEIVED",
        entityId: inv.id,
        entityRef: inv.invoiceNo || inv.id.slice(0, 8),
        amount: invAmount,
        date: invDate,
        confidence: Math.min(confidence, 1),
        matchReason: reasons.join(", "),
      };
    }
  }

  // Also check description for customer names even without exact invoice match
  if (!best) {
    for (const cust of customers) {
      if (nameInDescription(cust.name, description)) {
        // Find any invoice from this customer with matching amount
        const custInvoice = unpaidInvoices.find(
          (inv) =>
            inv.customer.id === cust.id &&
            Math.abs(Number(inv.totalSell) - amount) < 0.01
        );
        if (custInvoice) {
          best = {
            type: "PAYMENT_RECEIVED",
            entityId: custInvoice.id,
            entityRef: custInvoice.invoiceNo || custInvoice.id.slice(0, 8),
            amount: Number(custInvoice.totalSell),
            date: custInvoice.issuedAt || new Date(),
            confidence: 0.6,
            matchReason: "customer name + amount match",
          };
          break;
        }
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Matching: Outgoing (money OUT -> supplier bills)
// ---------------------------------------------------------------------------

function matchOutgoingTransaction(
  amount: number, // already positive
  description: string,
  txnDate: Date,
  unpaidBills: Array<{
    id: string;
    billNo: string;
    totalCost: unknown;
    billDate: Date;
    supplier: { id: string; name: string };
  }>,
  suppliers: Array<{ id: string; name: string }>
): MatchCandidate | null {
  let best: MatchCandidate | null = null;

  const billRefs = extractBillNumbers(description);

  for (const bill of unpaidBills) {
    let confidence = 0;
    const reasons: string[] = [];
    const billAmount = Number(bill.totalCost);
    const billDate = bill.billDate;

    // 1. Exact amount match
    if (Math.abs(billAmount - amount) < 0.01) {
      confidence += 0.5;
      reasons.push("exact amount");
    } else if (Math.abs(billAmount - amount) / Math.max(billAmount, 1) < 0.02) {
      confidence += 0.2;
      reasons.push("close amount");
    } else {
      continue;
    }

    // 2. Bill number in description
    if (billRefs.includes(bill.billNo.replace(/\s/g, "").toUpperCase())) {
      confidence += 0.35;
      reasons.push("bill ref in description");
    }

    // 3. Supplier name in description
    if (nameInDescription(bill.supplier.name, description)) {
      confidence += 0.2;
      reasons.push("supplier name match");
    }

    // 4. Date proximity
    const dateScore = dateProximityScore(txnDate, billDate);
    confidence += dateScore * 0.1;
    if (dateScore > 0.5) {
      reasons.push("date proximity");
    }

    if (confidence > (best?.confidence || 0)) {
      best = {
        type: "SUPPLIER_BILL",
        entityId: bill.id,
        entityRef: bill.billNo,
        amount: billAmount,
        date: billDate,
        confidence: Math.min(confidence, 1),
        matchReason: reasons.join(", "),
      };
    }
  }

  // Supplier name fallback
  if (!best) {
    for (const supp of suppliers) {
      if (nameInDescription(supp.name, description)) {
        const suppBill = unpaidBills.find(
          (b) =>
            b.supplier.id === supp.id &&
            Math.abs(Number(b.totalCost) - amount) < 0.01
        );
        if (suppBill) {
          best = {
            type: "SUPPLIER_BILL",
            entityId: suppBill.id,
            entityRef: suppBill.billNo,
            amount: Number(suppBill.totalCost),
            date: suppBill.billDate,
            confidence: 0.6,
            matchReason: "supplier name + amount match",
          };
          break;
        }
      }
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Apply reconciliation
// ---------------------------------------------------------------------------

/**
 * MANUAL ↔ BANK FEED dedup.
 * If the user already logged this payment manually (via /finance/payments)
 * BEFORE the bank feed pulled the matching txn, we must NOT create a second
 * Payment/PaymentMade — that would double-count cash and double-post the JE.
 *
 * Match rule: same amount, date within ±7 days, NOT already linked to any
 * BankTransaction. We pick the closest-by-date candidate.
 */
const MATCH_DATE_WINDOW_DAYS = 7;

async function findExistingPaymentForInvoice(
  salesInvoiceId: string,
  amount: number,
  txnDate: Date
): Promise<{ id: string } | null> {
  const lo = new Date(txnDate);
  lo.setDate(lo.getDate() - MATCH_DATE_WINDOW_DAYS);
  const hi = new Date(txnDate);
  hi.setDate(hi.getDate() + MATCH_DATE_WINDOW_DAYS);

  const candidates = await prisma.payment.findMany({
    where: {
      salesInvoiceId,
      amount: { gte: amount - 0.01, lte: amount + 0.01 },
      paymentDate: { gte: lo, lte: hi },
    },
    select: { id: true, paymentDate: true },
  });
  if (candidates.length === 0) return null;
  // Exclude payments already linked to any bank txn
  const linked = await prisma.bankTransaction.findMany({
    where: { matchedPaymentId: { in: candidates.map((c) => c.id) } },
    select: { matchedPaymentId: true },
  });
  const linkedIds = new Set(linked.map((l) => l.matchedPaymentId));
  const free = candidates.filter((c) => !linkedIds.has(c.id));
  if (free.length === 0) return null;
  free.sort(
    (a, b) =>
      Math.abs(a.paymentDate.getTime() - txnDate.getTime()) -
      Math.abs(b.paymentDate.getTime() - txnDate.getTime())
  );
  return { id: free[0].id };
}

async function findExistingPaymentMadeForBill(
  supplierBillId: string,
  amount: number,
  txnDate: Date
): Promise<{ id: string } | null> {
  const lo = new Date(txnDate);
  lo.setDate(lo.getDate() - MATCH_DATE_WINDOW_DAYS);
  const hi = new Date(txnDate);
  hi.setDate(hi.getDate() + MATCH_DATE_WINDOW_DAYS);

  // Find PaymentMade that allocates this bill, with matching amount + date
  const allocations = await prisma.paymentMadeAllocation.findMany({
    where: {
      supplierBillId,
      amount: { gte: amount - 0.01, lte: amount + 0.01 },
      paymentMade: { paymentDate: { gte: lo, lte: hi } },
    },
    include: {
      paymentMade: { select: { id: true, paymentDate: true } },
    },
  });
  if (allocations.length === 0) return null;
  const pmIds = allocations.map((a) => a.paymentMade.id);
  const linked = await prisma.bankTransaction.findMany({
    where: { matchedPaymentId: { in: pmIds } },
    select: { matchedPaymentId: true },
  });
  const linkedIds = new Set(linked.map((l) => l.matchedPaymentId));
  const free = allocations.filter((a) => !linkedIds.has(a.paymentMade.id));
  if (free.length === 0) return null;
  free.sort(
    (a, b) =>
      Math.abs(a.paymentMade.paymentDate.getTime() - txnDate.getTime()) -
      Math.abs(b.paymentMade.paymentDate.getTime() - txnDate.getTime())
  );
  return { id: free[0].paymentMade.id };
}

async function applyReconciliation(
  transactionId: string,
  match: MatchCandidate,
  bankAccountId: string
): Promise<void> {
  const now = new Date();
  const { postPaymentReceived, postPaymentMade } = await import("./gl-posting");

  // Pull the txn date once so dedup uses the bank-reported date, not "now"
  const txn = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    select: { transactionDate: true },
  });
  const txnDate = txn?.transactionDate ?? now;

  if (match.type === "PAYMENT_RECEIVED") {
    // ── Dedup: existing manual Payment for this invoice? ─────────────────
    const existing = await findExistingPaymentForInvoice(
      match.entityId,
      match.amount,
      txnDate
    );

    let paymentId: string;
    let je: { id: string };
    let dedupNote = "";

    if (existing) {
      // Manual payment already logged — link instead of duplicating.
      paymentId = existing.id;
      // postPaymentReceived is idempotent on (sourceType, sourceId), so this
      // returns the existing JE if one's already posted; otherwise it posts now.
      je = await postPaymentReceived(paymentId);
      dedupNote = " · linked to manual payment (no double-count)";
    } else {
      const payment = await prisma.payment.create({
        data: {
          salesInvoiceId: match.entityId,
          amount: match.amount,
          paymentDate: txnDate,
          paymentMethod: "BANK_TRANSFER",
          reference: `Bank reconciliation - txn ${transactionId.slice(0, 8)}`,
        },
      });
      paymentId = payment.id;
      je = await postPaymentReceived(paymentId);
    }

    await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: "RECONCILED",
        matchedPaymentId: paymentId,
        matchedJournalId: je.id,
        reconciledAt: now,
        notes: `Auto-reconciled: ${match.matchReason}${dedupNote}`,
      },
    });

    await prisma.salesInvoice.update({
      where: { id: match.entityId },
      data: { status: "PAID", paidAt: now },
    });
  } else if (match.type === "SUPPLIER_BILL") {
    const bill = await prisma.supplierBill.findUnique({
      where: { id: match.entityId },
      select: { supplierId: true },
    });
    if (!bill) throw new Error(`Bill ${match.entityId} not found`);

    // ── Dedup: existing manual PaymentMade for this bill? ────────────────
    const existing = await findExistingPaymentMadeForBill(
      match.entityId,
      match.amount,
      txnDate
    );

    let paymentMadeId: string;
    let je: { id: string };
    let dedupNote = "";

    if (existing) {
      paymentMadeId = existing.id;
      je = await postPaymentMade(paymentMadeId);
      dedupNote = " · linked to manual payment (no double-count)";
    } else {
      const paymentMade = await prisma.paymentMade.create({
        data: {
          supplierId: bill.supplierId,
          bankAccountId,
          paymentDate: txnDate,
          amount: match.amount,
          paymentMethod: "BANK_TRANSFER",
          reference: `Bank reconciliation - txn ${transactionId.slice(0, 8)}`,
        },
      });
      await prisma.paymentMadeAllocation.create({
        data: {
          paymentMadeId: paymentMade.id,
          supplierBillId: match.entityId,
          amount: match.amount,
        },
      });
      paymentMadeId = paymentMade.id;
      je = await postPaymentMade(paymentMadeId);
    }

    await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: "RECONCILED",
        matchedPaymentId: paymentMadeId,
        matchedJournalId: je.id,
        reconciledAt: now,
        notes: `Auto-reconciled: ${match.matchReason}${dedupNote}`,
      },
    });

    await prisma.supplierBill.update({
      where: { id: match.entityId },
      data: { status: "PAID" },
    });
  }
}

/**
 * POST /api/finance/bank-inbox/match
 *
 * Match a bank transaction to an existing SalesInvoice or SupplierBill.
 * Creates the corresponding Payment / PaymentMade record and posts the
 * settlement JE through gl-posting.ts. Marks the bank txn RECONCILED.
 *
 * Body:
 *   {
 *     bankTransactionId: string;
 *     matchType: "SALES_INVOICE" | "SUPPLIER_BILL";
 *     matchId: string;       // SalesInvoice.id or SupplierBill.id
 *   }
 */
import { prisma } from "@/lib/prisma";
import { postPaymentReceived, postPaymentMade } from "@/lib/finance/gl-posting";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      bankTransactionId?: string;
      matchType?: "SALES_INVOICE" | "SUPPLIER_BILL";
      matchId?: string;
    };
    const { bankTransactionId, matchType, matchId } = body;
    if (!bankTransactionId || !matchType || !matchId) {
      return Response.json(
        { error: "bankTransactionId, matchType, matchId required" },
        { status: 400 }
      );
    }

    const bt = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: { bankAccount: { select: { id: true } } },
    });
    if (!bt) return Response.json({ error: "BankTransaction not found" }, { status: 404 });

    const result = await prisma.$transaction(async (tx) => {
      const ref = `Bank match — ${bt.reference ?? bankTransactionId.slice(0, 8)}`;
      const amount = Math.abs(Number(bt.amount));
      const txnDate = bt.transactionDate;

      // ── Manual ↔ bank dedup window ──
      // If the user already logged a matching payment manually on
      // /finance/payments, we link to it instead of creating a duplicate.
      const dedupLo = new Date(txnDate);
      dedupLo.setDate(dedupLo.getDate() - 7);
      const dedupHi = new Date(txnDate);
      dedupHi.setDate(dedupHi.getDate() + 7);

      if (matchType === "SALES_INVOICE") {
        const inv = await tx.salesInvoice.findUnique({
          where: { id: matchId },
          include: { payments: true },
        });
        if (!inv) throw new Error("SalesInvoice not found");

        // Find existing manual Payment for this invoice within the window
        const candidates = await tx.payment.findMany({
          where: {
            salesInvoiceId: inv.id,
            amount: { gte: amount - 0.01, lte: amount + 0.01 },
            paymentDate: { gte: dedupLo, lte: dedupHi },
          },
          select: { id: true, paymentDate: true },
        });
        let existing: { id: string } | null = null;
        if (candidates.length > 0) {
          const linked = await tx.bankTransaction.findMany({
            where: { matchedPaymentId: { in: candidates.map((c) => c.id) } },
            select: { matchedPaymentId: true },
          });
          const linkedIds = new Set(linked.map((l) => l.matchedPaymentId));
          const free = candidates.filter((c) => !linkedIds.has(c.id));
          free.sort(
            (a, b) =>
              Math.abs(a.paymentDate.getTime() - txnDate.getTime()) -
              Math.abs(b.paymentDate.getTime() - txnDate.getTime())
          );
          if (free.length > 0) existing = { id: free[0].id };
        }

        let paymentId: string;
        let dedupNote = "";
        if (existing) {
          paymentId = existing.id;
          dedupNote = " · linked to manual payment (no double-count)";
        } else {
          const payment = await tx.payment.create({
            data: {
              salesInvoiceId: inv.id,
              amount,
              paymentDate: txnDate,
              paymentMethod: "BANK_TRANSFER",
              reference: ref,
            },
          });
          paymentId = payment.id;

          const totalPaid =
            inv.payments.reduce((s, p) => s + Number(p.amount), 0) + amount;
          if (totalPaid >= Number(inv.totalSell)) {
            await tx.salesInvoice.update({
              where: { id: inv.id },
              data: { status: "PAID", paidAt: txnDate },
            });
          }
        }

        // Idempotent: returns existing JE if already posted by manual entry.
        const je = await postPaymentReceived(paymentId, "1000", tx);
        await tx.bankTransaction.update({
          where: { id: bankTransactionId },
          data: {
            reconciliationStatus: "RECONCILED",
            matchedPaymentId: paymentId,
            matchedJournalId: je.id,
            reconciledAt: new Date(),
            notes: dedupNote
              ? `Matched to invoice ${inv.invoiceNo ?? inv.id}${dedupNote}`
              : null,
          },
        });
        return { paymentId, journalEntryId: je.id, linkedToManual: !!existing };
      }

      // SUPPLIER_BILL
      const bill = await tx.supplierBill.findUnique({ where: { id: matchId } });
      if (!bill) throw new Error("SupplierBill not found");

      // Find existing manual PaymentMade allocated to this bill within window
      const allocs = await tx.paymentMadeAllocation.findMany({
        where: {
          supplierBillId: bill.id,
          amount: { gte: amount - 0.01, lte: amount + 0.01 },
          paymentMade: { paymentDate: { gte: dedupLo, lte: dedupHi } },
        },
        include: { paymentMade: { select: { id: true, paymentDate: true } } },
      });
      let existingPm: { id: string } | null = null;
      if (allocs.length > 0) {
        const pmIds = allocs.map((a) => a.paymentMade.id);
        const linked = await tx.bankTransaction.findMany({
          where: { matchedPaymentId: { in: pmIds } },
          select: { matchedPaymentId: true },
        });
        const linkedIds = new Set(linked.map((l) => l.matchedPaymentId));
        const free = allocs.filter((a) => !linkedIds.has(a.paymentMade.id));
        free.sort(
          (a, b) =>
            Math.abs(a.paymentMade.paymentDate.getTime() - txnDate.getTime()) -
            Math.abs(b.paymentMade.paymentDate.getTime() - txnDate.getTime())
        );
        if (free.length > 0) existingPm = { id: free[0].paymentMade.id };
      }

      let paymentMadeId: string;
      let dedupNote = "";
      if (existingPm) {
        paymentMadeId = existingPm.id;
        dedupNote = " · linked to manual payment (no double-count)";
      } else {
        const pm = await tx.paymentMade.create({
          data: {
            supplierId: bill.supplierId,
            bankAccountId: bt.bankAccount.id,
            paymentDate: txnDate,
            amount,
            paymentMethod: "BANK_TRANSFER",
            reference: ref,
          },
        });
        await tx.paymentMadeAllocation.create({
          data: { paymentMadeId: pm.id, supplierBillId: bill.id, amount },
        });
        await tx.supplierBill.update({
          where: { id: bill.id },
          data: { status: "PAID" },
        });
        paymentMadeId = pm.id;
      }

      const je = await postPaymentMade(paymentMadeId, "1000", tx);
      await tx.bankTransaction.update({
        where: { id: bankTransactionId },
        data: {
          reconciliationStatus: "RECONCILED",
          matchedPaymentId: paymentMadeId,
          matchedJournalId: je.id,
          reconciledAt: new Date(),
          notes: dedupNote
            ? `Matched to bill ${bill.billNo ?? bill.id}${dedupNote}`
            : null,
        },
      });
      return { paymentMadeId, journalEntryId: je.id, linkedToManual: !!existingPm };
    });

    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("/api/finance/bank-inbox/match POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

// POST /api/banking/match-confirm
// Body: { matchId: string }  OR  { transactionId, matchType, matchedRecordId }
//
// Confirms a candidate match: marks the chosen BankTransactionMatch confirmed,
// dismisses sibling candidates for the same transaction, flips the
// BankTransaction reconciliationStatus -> RECONCILED, and writes
// matchedPaymentId / matchedJournalId convenience fields.
// For INVOICE matches we also stamp SalesInvoice.paidAt.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const matchId = body.matchId as string | undefined;

  let match = null;
  if (matchId) {
    match = await prisma.bankTransactionMatch.findUnique({ where: { id: matchId } });
  } else if (body.transactionId && body.matchType && body.matchedRecordId) {
    match = await prisma.bankTransactionMatch.findFirst({
      where: {
        bankTransactionId: body.transactionId,
        matchType: body.matchType,
        matchedRecordId: body.matchedRecordId,
      },
    });
  }
  if (!match) {
    return NextResponse.json({ error: "match_not_found" }, { status: 404 });
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.bankTransactionMatch.update({
      where: { id: match.id },
      data: { confirmedAt: now, dismissedAt: null },
    });

    // Dismiss siblings.
    await tx.bankTransactionMatch.updateMany({
      where: {
        bankTransactionId: match.bankTransactionId,
        id: { not: match.id },
      },
      data: { dismissedAt: now },
    });

    await tx.bankTransaction.update({
      where: { id: match.bankTransactionId },
      data: {
        reconciliationStatus: "RECONCILED",
        reconciledAt: now,
        ...(match.matchType === "INVOICE"
          ? { matchedPaymentId: match.matchedRecordId }
          : { matchedJournalId: match.matchedRecordId }),
      },
    });

    if (match.matchType === "INVOICE") {
      await tx.salesInvoice.update({
        where: { id: match.matchedRecordId },
        data: { paidAt: now, status: "PAID" },
      });
    } else if (match.matchType === "BILL") {
      await tx.supplierBill.update({
        where: { id: match.matchedRecordId },
        data: { paymentStatus: "PAID" },
      });
    }
  });

  return NextResponse.json({ ok: true });
}

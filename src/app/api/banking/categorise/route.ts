// POST /api/banking/categorise
// Body: { transactionId: string, accountId: string, notes?: string }
//
// Categorise manually — link a bank transaction directly to a ChartOfAccount
// (bank charges, fuel, etc.) without an invoice/bill match.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const transactionId = (body.transactionId as string | undefined)?.trim();
  const accountId = (body.accountId as string | undefined)?.trim();
  const notes = body.notes as string | undefined;

  if (!transactionId || !accountId) {
    return NextResponse.json(
      { error: "transactionId and accountId required" },
      { status: 400 },
    );
  }

  const account = await prisma.chartOfAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    return NextResponse.json({ error: "account_not_found" }, { status: 404 });
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.bankTransaction.update({
      where: { id: transactionId },
      data: {
        reconciliationStatus: "RECONCILED",
        reconciledAt: now,
        matchedJournalId: accountId,
        notes: notes ?? `Categorised to ${account.accountCode} ${account.accountName}`,
      },
    });
    await tx.bankTransactionMatch.updateMany({
      where: { bankTransactionId: transactionId },
      data: { dismissedAt: now },
    });
  });

  return NextResponse.json({ ok: true });
}

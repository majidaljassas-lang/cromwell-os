// POST /api/banking/match-run
// Body: { bankAccountId?: string, transactionId?: string }
// Runs the matcher across UNRECONCILED transactions and writes
// BankTransactionMatch candidate rows.

import { NextRequest, NextResponse } from "next/server";
import { runMatcher } from "@/lib/banking/matcher";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const summary = await runMatcher({
    bankAccountId: body.bankAccountId,
    transactionId: body.transactionId,
  });
  return NextResponse.json(summary);
}

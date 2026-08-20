// POST /api/banking/exclude
// Body: { transactionId: string, exclude: boolean }
// Mark a bank transaction as EXCLUDED (won't show in Uncategorised) or revert.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const transactionId = (body.transactionId as string | undefined)?.trim();
  const exclude = body.exclude !== false;

  if (!transactionId) {
    return NextResponse.json({ error: "transactionId required" }, { status: 400 });
  }

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: {
      reconciliationStatus: exclude ? "EXCLUDED" : "UNRECONCILED",
    },
  });

  return NextResponse.json({ ok: true });
}

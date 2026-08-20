// POST /api/banking/match-dismiss
// Body: { matchId: string }
// Dismiss a single candidate without affecting siblings.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const matchId = (body.matchId as string | undefined)?.trim();
  if (!matchId) {
    return NextResponse.json({ error: "matchId required" }, { status: 400 });
  }

  await prisma.bankTransactionMatch.update({
    where: { id: matchId },
    data: { dismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}

/**
 * GET  /api/finance/period-close      — list all fiscal periods + JE counts
 * POST /api/finance/period-close      — change a period's status
 *   Body: { periodId: string, status: "OPEN" | "CLOSED" | "LOCKED" }
 *
 * Status semantics:
 *   OPEN   — anything posts
 *   CLOSED — soft warning (UI flag); JEs still post
 *   LOCKED — gl-posting.ts rejects new postings (hard wall)
 */
import { prisma } from "@/lib/prisma";

export async function GET() {
  const periods = await prisma.fiscalPeriod.findMany({
    orderBy: { startDate: "desc" },
    include: { _count: { select: { entries: true } } },
  });
  return Response.json({ periods });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { periodId?: string; status?: string };
    const { periodId, status } = body;
    if (!periodId || !status || !["OPEN", "CLOSED", "LOCKED"].includes(status)) {
      return Response.json(
        { error: "periodId + status (OPEN | CLOSED | LOCKED) required" },
        { status: 400 }
      );
    }
    const updated = await prisma.fiscalPeriod.update({
      where: { id: periodId },
      data: {
        status,
        closedAt: status === "OPEN" ? null : new Date(),
      },
    });
    return Response.json({ ok: true, period: updated });
  } catch (e) {
    console.error("/api/finance/period-close POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

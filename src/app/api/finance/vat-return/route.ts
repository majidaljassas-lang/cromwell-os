/**
 * GET  /api/finance/vat-return — list returns
 * POST /api/finance/vat-return — generate / refresh a draft return for a period
 *   Body: { periodStart: "YYYY-MM-DD", periodEnd: "YYYY-MM-DD" }
 */
import { prisma } from "@/lib/prisma";
import { generateOrUpdateReturn } from "@/lib/finance/vat-return";

export async function GET() {
  const returns = await prisma.vATReturn.findMany({
    orderBy: { periodStart: "desc" },
    take: 24,
  });
  return Response.json({ returns });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { periodStart?: string; periodEnd?: string };
    if (!body.periodStart || !body.periodEnd) {
      return Response.json(
        { error: "periodStart, periodEnd required (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const ps = new Date(body.periodStart);
    const pe = new Date(`${body.periodEnd}T23:59:59.999Z`);
    const result = await generateOrUpdateReturn(ps, pe);
    return Response.json({ ok: true, return: result });
  } catch (e) {
    console.error("/api/finance/vat-return POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

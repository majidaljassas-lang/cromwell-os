/**
 * GET  /api/intake/queue        → counts by DocumentQueueStatus + recent docs
 * POST /api/intake/queue        → { action: "tick" } runs all pending workers
 */

import { runAllPending } from "@/lib/intake";
import { queueCounts }   from "@/lib/intake/queue";
import { prisma }        from "@/lib/prisma";

export async function GET() {
  const CUTOVER = new Date("2026-04-01");

  const [counts, recent, docCount, billCount, lineStats, supplierStats, dupes] = await Promise.all([
    queueCounts(),
    prisma.intakeDocument.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true, sourceType: true, sourceRef: true, status: true,
        retryCount: true, errorMessage: true, supplierBillId: true,
        nextAttemptAt: true, lastAttemptAt: true, createdAt: true,
      },
    }),
    prisma.intakeDocument.count({ where: { createdAt: { gte: CUTOVER } } }),
    prisma.supplierBill.count({ where: { billDate: { gte: CUTOVER } } }),
    prisma.supplierBillLine.groupBy({
      by: ["allocationStatus"],
      where: { supplierBill: { billDate: { gte: CUTOVER } } },
      _count: { _all: true },
      _sum:   { lineTotal: true },
    }),
    // Per-supplier match quality
    prisma.$queryRaw<Array<{
      supplier: string; bills: bigint; lines: bigint; matched: bigint; suggested: bigint; unallocated: bigint; total_cost: number;
    }>>`
      SELECT
        s.name AS supplier,
        COUNT(DISTINCT sb.id)::bigint AS bills,
        COUNT(sbl.id)::bigint AS lines,
        SUM(CASE WHEN sbl."allocationStatus" = 'MATCHED'      THEN 1 ELSE 0 END)::bigint AS matched,
        SUM(CASE WHEN sbl."allocationStatus" = 'SUGGESTED'    THEN 1 ELSE 0 END)::bigint AS suggested,
        SUM(CASE WHEN sbl."allocationStatus" = 'UNALLOCATED'  THEN 1 ELSE 0 END)::bigint AS unallocated,
        COALESCE(SUM(sbl."lineTotal"), 0)::float8 AS total_cost
      FROM "Supplier" s
      JOIN "SupplierBill" sb     ON sb."supplierId" = s.id
      JOIN "SupplierBillLine" sbl ON sbl."supplierBillId" = sb.id
      WHERE sb."billDate" >= ${CUTOVER}
      GROUP BY s.name
      ORDER BY lines DESC
    `,
    prisma.supplierBill.count({ where: { billDate: { gte: CUTOVER }, duplicateStatus: { not: null } } }),
  ]);

  const totalLines = lineStats.reduce((s, r) => s + (r._count?._all ?? 0), 0);
  const matchedLines    = lineStats.find((r) => r.allocationStatus === "MATCHED")?._count?._all ?? 0;
  const suggestedLines  = lineStats.find((r) => r.allocationStatus === "SUGGESTED")?._count?._all ?? 0;
  const unallocLines    = lineStats.find((r) => r.allocationStatus === "UNALLOCATED")?._count?._all ?? 0;

  const kpis = {
    docsIngested:      docCount,
    billsIngested:     billCount,
    totalLines,
    matchedLines,
    suggestedLines,
    unallocLines,
    autoMatchRate:  totalLines ? Math.round((matchedLines    / totalLines) * 100) : 0,
    reviewRate:     totalLines ? Math.round((suggestedLines  / totalLines) * 100) : 0,
    unallocRate:    totalLines ? Math.round((unallocLines    / totalLines) * 100) : 0,
    duplicateBills: dupes,
    suppliers: supplierStats.map((s) => ({
      supplier:    s.supplier,
      bills:       Number(s.bills),
      lines:       Number(s.lines),
      matched:     Number(s.matched),
      suggested:   Number(s.suggested),
      unallocated: Number(s.unallocated),
      totalCost:   s.total_cost,
      matchPct:    Number(s.lines) > 0 ? Math.round((Number(s.matched) / Number(s.lines)) * 100) : 0,
    })),
  };

  return Response.json({ counts, recent, kpis });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: string }).action;
    if (action !== "tick") {
      return Response.json({ error: `Unknown action '${action}' — expected 'tick'` }, { status: 400 });
    }
    const result = await runAllPending();
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "tick failed" }, { status: 500 });
  }
}

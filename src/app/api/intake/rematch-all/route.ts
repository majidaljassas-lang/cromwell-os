/**
 * POST /api/intake/rematch-all
 *
 * Re-runs the multi-signal match engine + auto-link across every post-cutover
 * supplier-bill line that isn't already MATCHED. Use this after seeding new
 * SupplierAlias / SupplierProductMapping rows so the engine picks them up.
 *
 * Optional body: { resetMatched?: boolean } — if true, also re-runs over MATCHED lines.
 */
import { prisma } from "@/lib/prisma";
import { autoLinkBillLine } from "@/lib/ingestion/auto-link-bill-line";
import { matchBillLine }     from "@/lib/intake/match-engine";

const CUTOVER = new Date("2026-04-01");

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { resetMatched?: boolean };
    const where: Record<string, unknown> = {
      supplierBill: { billDate: { gte: CUTOVER } },
    };
    if (!body.resetMatched) where.allocationStatus = { not: "MATCHED" };

    const lines = await prisma.supplierBillLine.findMany({
      where,
      select: { id: true, allocationStatus: true },
    });

    let auto = 0, suggested = 0, noMatch = 0, errors = 0;
    for (const l of lines) {
      try {
        const r = await autoLinkBillLine(l.id, "rematch-sweep");
        if (r.action === "AUTO_LINKED") auto++;
        else if (r.action === "SUGGESTED") suggested++;
        else noMatch++;
      } catch { errors++; }
      try { await matchBillLine(l.id); } catch { /* match-engine writes BillLineMatch even if it fails */ }
    }

    return Response.json({
      ok: true,
      scanned: lines.length,
      autoLinked: auto,
      suggested,
      noMatch,
      errors,
    });
  } catch (e) {
    console.error("rematch-all failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

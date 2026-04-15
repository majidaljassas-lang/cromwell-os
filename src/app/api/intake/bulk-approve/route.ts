/**
 * POST /api/intake/bulk-approve
 *
 * Auto-approves SUGGESTED bill lines whose top BillLineMatch candidate scores
 * ≥ minOverall AND productConfidence ≥ minProduct. Each approval goes through
 * the same suggestions endpoint so the learning loop fires (BillIntakeCorrection
 * + SupplierProductMapping seed).
 *
 * Body: { minOverall?: number = 90; minProduct?: number = 80 }
 */
import { prisma } from "@/lib/prisma";

const CUTOVER = new Date("2026-04-01");

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { minOverall?: number; minProduct?: number };
    const minOverall = body.minOverall ?? 90;
    const minProduct = body.minProduct ?? 80;

    // Pull every SUGGESTED line on a post-cutover bill, with its top BillLineMatch
    const lines = await prisma.supplierBillLine.findMany({
      where: { allocationStatus: "SUGGESTED", supplierBill: { billDate: { gte: CUTOVER } } },
      select: {
        id: true,
        billLineMatches: {
          orderBy: { overallConfidence: "desc" },
          take: 1,
          select: {
            candidateType: true, candidateId: true,
            overallConfidence: true, productConfidence: true,
          },
        },
      },
    });

    let approved = 0, skipped = 0, errors = 0;
    const approvedDetails: Array<{ lineId: string; type: string; overall: number; product: number }> = [];
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    const host  = request.headers.get("host") ?? "localhost:3000";
    const base  = `${proto}://${host}`;

    for (const l of lines) {
      const top = l.billLineMatches[0];
      if (!top) { skipped++; continue; }
      const overall = Number(top.overallConfidence ?? 0);
      const product = Number(top.productConfidence ?? 0);
      if (overall < minOverall || product < minProduct) { skipped++; continue; }

      try {
        const r = await fetch(`${base}/api/supplier-bills/lines/${l.id}/suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "APPROVE", recordType: top.candidateType, recordId: top.candidateId }),
        });
        if (r.ok) {
          approved++;
          approvedDetails.push({ lineId: l.id, type: top.candidateType, overall, product });
        } else { errors++; }
      } catch { errors++; }
    }

    return Response.json({
      ok: true,
      thresholds: { minOverall, minProduct },
      eligible: lines.length,
      approved,
      skipped,
      errors,
      sample: approvedDetails.slice(0, 10),
    });
  } catch (e) {
    console.error("/api/intake/bulk-approve failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

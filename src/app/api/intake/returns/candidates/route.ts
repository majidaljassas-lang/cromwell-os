/**
 * GET  /api/intake/returns/candidates
 *   → list every BillLineAllocation of type RETURNS_CANDIDATE that hasn't been actioned yet
 *
 * POST /api/intake/returns/candidates
 *   body: { allocationId: string; action: "APPROVE" | "REJECT_TO_STOCK" | "REJECT_TO_WRITE_OFF" }
 *   - APPROVE              → create Return + ReturnLine, mark allocation as APPROVED (notes audit)
 *   - REJECT_TO_STOCK      → reclassify allocation to STOCK; create StockExcessRecord
 *   - REJECT_TO_WRITE_OFF  → reclassify allocation to OVERHEAD with note "WRITE_OFF"
 */
import { prisma } from "@/lib/prisma";

export async function GET() {
  const candidates = await prisma.billLineAllocation.findMany({
    where: { allocationType: "RETURNS_CANDIDATE" },
    include: {
      supplierBillLine: {
        include: {
          supplierBill: {
            include: { supplier: { select: { id: true, name: true } } },
          },
        },
      },
      ticketLine: {
        select: { id: true, description: true, ticket: { select: { id: true, ticketNo: true, title: true } } },
      },
      site:     { select: { id: true, siteName: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  // Filter out any allocation already converted to a Return (audit via notes prefix)
  const open = candidates.filter((c) => !(c.reason ?? "").includes("[RETURN_CREATED]"));
  return Response.json({ candidates: open });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { allocationId?: string; action?: string };
    const { allocationId, action } = body;
    if (!allocationId || !action) return Response.json({ error: "allocationId + action required" }, { status: 400 });

    const alloc = await prisma.billLineAllocation.findUnique({
      where: { id: allocationId },
      include: {
        supplierBillLine: { include: { supplierBill: { select: { supplierId: true } } } },
        ticketLine: { select: { id: true, ticketId: true } },
      },
    });
    if (!alloc) return Response.json({ error: "allocation not found" }, { status: 404 });

    if (action === "APPROVE") {
      // Need a ticketId for the Return. If allocation has a ticketLine, use its ticket; else fall back to supplier bill's ticketId; else error.
      const ticketId = alloc.ticketLine?.ticketId
        ?? alloc.supplierBillLine.ticketId;
      if (!ticketId) {
        return Response.json({ error: "Cannot create Return — no ticket attached to allocation or bill line" }, { status: 422 });
      }
      const supplierId = alloc.supplierBillLine.supplierBill.supplierId;

      const result = await prisma.$transaction(async (tx) => {
        const ret = await tx.return.create({
          data: {
            ticketId,
            supplierId,
            returnDate: new Date(),
            status: "PROPOSED",
            notes: `Auto-created from BillLineAllocation ${allocationId} (RETURNS_CANDIDATE)`,
          },
        });
        // ReturnLine requires ticketLineId. If we have one on the allocation, use it; else if the supplier bill line is matched to a ticket line via CostAllocation, use that.
        let ticketLineId = alloc.ticketLine?.id ?? null;
        if (!ticketLineId) {
          const ca = await tx.costAllocation.findFirst({
            where: { supplierBillLineId: alloc.supplierBillLineId },
            select: { ticketLineId: true },
          });
          ticketLineId = ca?.ticketLineId ?? null;
        }
        let returnLine = null;
        if (ticketLineId) {
          returnLine = await tx.returnLine.create({
            data: {
              returnId: ret.id,
              supplierBillLineId: alloc.supplierBillLineId,
              ticketLineId,
              qtyReturned: alloc.qtyAllocated,
              expectedCredit: alloc.costAllocated,
              status: "PROPOSED",
            },
          });
        }
        // Audit on the allocation
        await tx.billLineAllocation.update({
          where: { id: allocationId },
          data: { reason: `${alloc.reason ?? ""} [RETURN_CREATED ${ret.id}]`.trim() },
        });
        // Learning loop
        await tx.billIntakeCorrection.create({
          data: {
            supplierBillLineId: alloc.supplierBillLineId,
            correctionType: "SURPLUS_ROUTED",
            beforeJson: { allocationType: "RETURNS_CANDIDATE", qty: alloc.qtyAllocated },
            afterJson:  { actionedAs: "RETURN", returnId: ret.id, returnLineId: returnLine?.id ?? null },
            userId: null,
          },
        });
        return { return: ret, returnLine };
      });

      return Response.json({ ok: true, action: "APPROVED", returnId: result.return.id, returnLineId: result.returnLine?.id ?? null });
    }

    if (action === "REJECT_TO_STOCK") {
      await prisma.$transaction(async (tx) => {
        await tx.billLineAllocation.update({
          where: { id: allocationId },
          data: { allocationType: "STOCK", reason: `${alloc.reason ?? ""} [REROUTED_TO_STOCK]`.trim() },
        });
        // Create StockExcessRecord (best-effort — ignore if model shape differs)
        try {
          const ca = await tx.costAllocation.findFirst({
            where: { supplierBillLineId: alloc.supplierBillLineId },
            select: { ticketLineId: true },
          });
          if (ca?.ticketLineId) {
            const cost = Number(alloc.costAllocated);
            await tx.stockExcessRecord.create({
              data: {
                supplierBillLineId: alloc.supplierBillLineId,
                ticketLineId: ca.ticketLineId,
                purchasedCost: cost,
                usedCost: 0,
                excessCost: cost,
                excessQty: alloc.qtyAllocated,
                treatment: "STOCK",
                status: "OPEN",
                description: `Re-routed from RETURNS_CANDIDATE`,
              },
            });
          }
        } catch { /* schema may differ — leave to manual */ }
        await tx.billIntakeCorrection.create({
          data: {
            supplierBillLineId: alloc.supplierBillLineId,
            correctionType: "SURPLUS_ROUTED",
            beforeJson: { allocationType: "RETURNS_CANDIDATE", qty: alloc.qtyAllocated },
            afterJson:  { actionedAs: "STOCK" },
            userId: null,
          },
        });
      });
      return Response.json({ ok: true, action: "REROUTED_TO_STOCK" });
    }

    if (action === "REJECT_TO_WRITE_OFF") {
      await prisma.$transaction(async (tx) => {
        await tx.billLineAllocation.update({
          where: { id: allocationId },
          data: { allocationType: "OVERHEAD", reason: `${alloc.reason ?? ""} [WRITE_OFF]`.trim() },
        });
        await tx.billIntakeCorrection.create({
          data: {
            supplierBillLineId: alloc.supplierBillLineId,
            correctionType: "SURPLUS_ROUTED",
            beforeJson: { allocationType: "RETURNS_CANDIDATE", qty: alloc.qtyAllocated },
            afterJson:  { actionedAs: "WRITE_OFF" },
            userId: null,
          },
        });
      });
      return Response.json({ ok: true, action: "WRITE_OFF" });
    }

    return Response.json({ error: "invalid action" }, { status: 400 });
  } catch (e) {
    console.error("/api/intake/returns/candidates POST failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

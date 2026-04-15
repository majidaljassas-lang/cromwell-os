/**
 * GET  /api/supplier-bills/lines/:lineId/suggestions    → top candidates for this line
 * POST /api/supplier-bills/lines/:lineId/suggestions    → { action: "APPROVE"|"REJECT", recordType, recordId }
 */
import { prisma } from "@/lib/prisma";
import { autoLinkBillLine } from "@/lib/ingestion/auto-link-bill-line";

export async function GET(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const result = await autoLinkBillLine(lineId, "preview");
  return Response.json({
    candidate: result.candidate,
    candidates: result.allCandidates,
    action: result.action,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await params;
  const body = await request.json();
  const { action, recordType, recordId } = body as { action: "APPROVE" | "REJECT"; recordType?: "TICKET_LINE" | "PO_LINE" | "INVOICE_LINE"; recordId?: string };

  const billLine = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    include: { supplierBill: { select: { supplierId: true } } },
  });
  if (!billLine) return Response.json({ error: "line not found" }, { status: 404 });

  // Snapshot BEFORE state for the learning loop
  const beforeSnapshot = {
    allocationStatus: billLine.allocationStatus,
    ticketId: billLine.ticketId,
    siteId: billLine.siteId,
    customerId: billLine.customerId,
  };

  if (action === "REJECT") {
    await prisma.supplierBillLine.update({
      where: { id: lineId },
      data: { allocationStatus: "EXCEPTION", ticketId: null, siteId: null, customerId: null },
    });
    await prisma.costAllocation.deleteMany({ where: { supplierBillLineId: lineId } });
    // Learning loop: capture rejection so the matcher learns this candidate was wrong
    try {
      await prisma.billIntakeCorrection.create({
        data: {
          supplierBillLineId: lineId,
          correctionType: "REJECTED",
          beforeJson: beforeSnapshot,
          afterJson: { allocationStatus: "EXCEPTION", ticketId: null, siteId: null, customerId: null },
          userId: null,
        },
      });
    } catch (e) { console.warn("BillIntakeCorrection write failed:", e instanceof Error ? e.message : e); }
    return Response.json({ ok: true, status: "EXCEPTION" });
  }

  if (action === "APPROVE" && recordType && recordId) {
    let ticketId: string | null = null;
    let siteId: string | null = null;
    let customerId: string | null = null;
    let ticketLineId: string | null = null;

    if (recordType === "TICKET_LINE") {
      const tl = await prisma.ticketLine.findUnique({
        where: { id: recordId },
        select: { id: true, ticketId: true, siteId: true, payingCustomerId: true, ticket: { select: { siteId: true, payingCustomerId: true } } },
      });
      if (!tl) return Response.json({ error: "ticket line not found" }, { status: 404 });
      ticketLineId = tl.id;
      ticketId = tl.ticketId;
      siteId = tl.siteId ?? tl.ticket?.siteId ?? null;
      customerId = tl.payingCustomerId ?? tl.ticket?.payingCustomerId ?? null;
    } else if (recordType === "PO_LINE") {
      const pl = await prisma.customerPOLine.findUnique({
        where: { id: recordId },
        select: { customerPO: { select: { ticketId: true, siteId: true, customerId: true } } },
      });
      if (!pl) return Response.json({ error: "po line not found" }, { status: 404 });
      ticketId = pl.customerPO?.ticketId ?? null;
      siteId = pl.customerPO?.siteId ?? null;
      customerId = pl.customerPO?.customerId ?? null;
    } else if (recordType === "INVOICE_LINE") {
      const il = await prisma.salesInvoiceLine.findUnique({
        where: { id: recordId },
        select: { ticketLineId: true, salesInvoice: { select: { ticketId: true, siteId: true, customerId: true } } },
      });
      if (!il) return Response.json({ error: "invoice line not found" }, { status: 404 });
      ticketLineId = il.ticketLineId;
      ticketId = il.salesInvoice?.ticketId ?? null;
      siteId = il.salesInvoice?.siteId ?? null;
      customerId = il.salesInvoice?.customerId ?? null;
    }

    await prisma.supplierBillLine.update({
      where: { id: lineId },
      data: { allocationStatus: "MATCHED", ticketId, siteId, customerId },
    });

    if (ticketLineId) {
      const exists = await prisma.costAllocation.findFirst({ where: { supplierBillLineId: lineId, ticketLineId } });
      if (!exists) {
        await prisma.costAllocation.create({
          data: {
            ticketLineId,
            supplierBillLineId: lineId,
            supplierId: billLine.supplierBill.supplierId,
            qtyAllocated: billLine.qty,
            unitCost: billLine.unitCost,
            totalCost: billLine.lineTotal,
            allocationStatus: "MATCHED",
            confidenceScore: 100,
            notes: "User-approved suggestion",
          },
        });
      }
    }

    // Learning loop: capture user's pick. If the chosen ticket differs from what was pre-suggested,
    // it's a TICKET_REASSIGNED correction; otherwise an SKU_MAPPED confirmation.
    try {
      const correctionType =
        beforeSnapshot.ticketId && beforeSnapshot.ticketId !== ticketId ? "TICKET_REASSIGNED" : "SKU_MAPPED";
      await prisma.billIntakeCorrection.create({
        data: {
          supplierBillLineId: lineId,
          correctionType,
          beforeJson: beforeSnapshot,
          afterJson: { allocationStatus: "MATCHED", ticketId, siteId, customerId, ticketLineId, recordType, recordId },
          userId: null,
        },
      });
    } catch (e) { console.warn("BillIntakeCorrection write failed:", e instanceof Error ? e.message : e); }

    // Auto-learner: seed/upsert a SupplierProductMapping so the engine resolves this supplier+SKU
    // straight to the canonical product on future bills. Pull the canonical name from whichever
    // record was approved (TicketLine description / PO line / Invoice line).
    try {
      const supplierId = billLine.supplierBill.supplierId;
      const sku = billLine.extractedSku ?? billLine.productCode ?? null;
      const description = billLine.description;
      let canonicalName: string | null = null;
      if (recordType === "TICKET_LINE") {
        const tl = await prisma.ticketLine.findUnique({ where: { id: recordId }, select: { description: true } });
        canonicalName = tl?.description ?? null;
      } else if (recordType === "PO_LINE") {
        const pl = await prisma.customerPOLine.findUnique({ where: { id: recordId }, select: { description: true } });
        canonicalName = pl?.description ?? null;
      } else if (recordType === "INVOICE_LINE") {
        const il = await prisma.salesInvoiceLine.findUnique({ where: { id: recordId }, select: { description: true } });
        canonicalName = il?.description ?? null;
      }
      const normalised = (canonicalName ?? description).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      if (sku) {
        await prisma.supplierProductMapping.upsert({
          where: { supplierId_supplierSku: { supplierId, supplierSku: sku } },
          create: {
            supplierId, supplierSku: sku,
            supplierDescription: description,
            canonicalName,
            normalizedItemName: normalised,
            defaultUom: billLine.originalUom ?? null,
            defaultPackSize: billLine.packSize ?? null,
            observationCount: 1,
            lastSeenAt: new Date(),
            lastUnitCost: billLine.unitCost,
          },
          update: {
            canonicalName: canonicalName ?? undefined,
            normalizedItemName: normalised,
            observationCount: { increment: 1 },
            lastSeenAt: new Date(),
            lastUnitCost: billLine.unitCost,
            // refresh defaults if the bill carried better signal
            defaultUom: billLine.originalUom ?? undefined,
            defaultPackSize: billLine.packSize ?? undefined,
            supplierDescription: description,
          },
        });
      } else {
        // No SKU — still record by description so future bills with same desc match faster.
        // Use a stable synthetic key derived from normalised description so we don't blow up on duplicates.
        const syntheticSku = `desc:${normalised.slice(0, 64)}`;
        await prisma.supplierProductMapping.upsert({
          where: { supplierId_supplierSku: { supplierId, supplierSku: syntheticSku } },
          create: {
            supplierId, supplierSku: syntheticSku,
            supplierDescription: description,
            canonicalName,
            normalizedItemName: normalised,
            defaultUom: billLine.originalUom ?? null,
            observationCount: 1,
            lastSeenAt: new Date(),
            lastUnitCost: billLine.unitCost,
          },
          update: {
            canonicalName: canonicalName ?? undefined,
            observationCount: { increment: 1 },
            lastSeenAt: new Date(),
            lastUnitCost: billLine.unitCost,
          },
        });
      }
    } catch (e) {
      console.warn("SupplierProductMapping auto-seed failed:", e instanceof Error ? e.message : e);
    }

    return Response.json({ ok: true, status: "MATCHED", ticketId, siteId, customerId });
  }

  return Response.json({ error: "invalid action" }, { status: 400 });
}

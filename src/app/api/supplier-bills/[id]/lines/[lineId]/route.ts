import { prisma } from "@/lib/prisma";
import { CostClassification } from "@/generated/prisma";

const VALID_COST_CLASSIFICATIONS = [
  "BILLABLE",
  "ABSORBED",
  "REALLOCATABLE",
  "STOCK",
  "MOQ_EXCESS",
  "WRITE_OFF",
  "CREDIT",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const { id, lineId } = await params;
    const body = await request.json();

    const line = await prisma.supplierBillLine.findFirst({
      where: { id: lineId, supplierBillId: id },
      select: { id: true, qty: true, unitCost: true },
    });
    if (!line) {
      return Response.json({ error: "Line not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (body.costClassification !== undefined) {
      if (!VALID_COST_CLASSIFICATIONS.includes(body.costClassification)) {
        return Response.json(
          { error: `invalid costClassification: ${body.costClassification}` },
          { status: 400 }
        );
      }
      data.costClassification = body.costClassification as CostClassification;
    }

    if (body.vatRate !== undefined) {
      if (body.vatRate === null) {
        data.vatRate = null;
      } else {
        const n = Number(body.vatRate);
        if (!Number.isFinite(n)) {
          return Response.json({ error: "vatRate must be a number" }, { status: 400 });
        }
        data.vatRate = n;
      }
    }

    if (body.vatStatus !== undefined) {
      data.vatStatus = body.vatStatus === null ? null : String(body.vatStatus);
    }

    if (body.ticketId !== undefined) {
      data.ticketId = body.ticketId === null ? null : String(body.ticketId);
    }

    if (body.customerId !== undefined) {
      if (body.customerId === null) {
        data.customerId = null;
      } else {
        const customerId = String(body.customerId);
        const exists = await prisma.customer.findUnique({
          where: { id: customerId },
          select: { id: true },
        });
        if (!exists) {
          return Response.json({ error: `customerId ${customerId} not found` }, { status: 400 });
        }
        data.customerId = customerId;
      }
    }

    if (body.siteId !== undefined) {
      if (body.siteId === null) {
        data.siteId = null;
      } else {
        const siteId = String(body.siteId);
        const exists = await prisma.site.findUnique({
          where: { id: siteId },
          select: { id: true },
        });
        if (!exists) {
          return Response.json({ error: `siteId ${siteId} not found` }, { status: 400 });
        }
        data.siteId = siteId;
      }
    }

    if (body.description !== undefined) {
      const desc = String(body.description).trim();
      if (!desc) {
        return Response.json({ error: "description cannot be empty" }, { status: 400 });
      }
      data.description = desc;
    }

    let nextQty: number | null = null;
    let nextUnitCost: number | null = null;

    if (body.qty !== undefined) {
      const n = Number(body.qty);
      if (!Number.isFinite(n) || n <= 0) {
        return Response.json({ error: "qty must be a positive number" }, { status: 400 });
      }
      data.qty = n;
      nextQty = n;
    }

    if (body.unitCost !== undefined) {
      const n = Number(body.unitCost);
      if (!Number.isFinite(n)) {
        return Response.json({ error: "unitCost must be a number" }, { status: 400 });
      }
      data.unitCost = n;
      nextUnitCost = n;
    }

    if (body.lineTotal !== undefined) {
      const n = Number(body.lineTotal);
      if (!Number.isFinite(n)) {
        return Response.json({ error: "lineTotal must be a number" }, { status: 400 });
      }
      data.lineTotal = n;
    } else if (nextQty !== null || nextUnitCost !== null) {
      // Recompute lineTotal when qty or unitCost changed and no explicit lineTotal sent.
      const qty = nextQty !== null ? nextQty : Number(line.qty);
      const unitCost = nextUnitCost !== null ? nextUnitCost : Number(line.unitCost);
      data.lineTotal = Number((qty * unitCost).toFixed(2));
    }

    if (body.glAccountId !== undefined) {
      if (body.glAccountId === null) {
        data.glAccountId = null;
      } else {
        const glId = String(body.glAccountId);
        const exists = await prisma.chartOfAccount.findUnique({
          where: { id: glId },
          select: { id: true },
        });
        if (!exists) {
          return Response.json(
            { error: `glAccountId ${glId} not found in ChartOfAccount` },
            { status: 400 },
          );
        }
        data.glAccountId = glId;
      }
    }

    if (Object.keys(data).length === 0) {
      return Response.json({ error: "no fields to update" }, { status: 400 });
    }

    const updated = await prisma.supplierBillLine.update({
      where: { id: lineId },
      data,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to patch bill line:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to patch line" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  try {
    const { id, lineId } = await params;

    const line = await prisma.supplierBillLine.findFirst({
      where: { id: lineId, supplierBillId: id },
      select: { id: true },
    });
    if (!line) {
      return Response.json({ error: "Line not found" }, { status: 404 });
    }

    // Delete dependent rows first (mirrors SupplierBill DELETE pattern).
    await prisma.costAllocation.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.absorbedCostAllocation.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.billLineAllocation.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.billLineMatch.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.stockExcessRecord.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.returnLine.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.ingestionLink.deleteMany({ where: { supplierBillLineId: lineId } });
    await prisma.billIntakeCorrection.deleteMany({ where: { supplierBillLineId: lineId } });

    await prisma.supplierBillLine.delete({ where: { id: lineId } });

    return Response.json({ deleted: true, id: lineId });
  } catch (error) {
    console.error("Failed to delete bill line:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete line" },
      { status: 500 }
    );
  }
}

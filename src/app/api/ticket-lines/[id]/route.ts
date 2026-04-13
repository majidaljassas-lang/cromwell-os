import { prisma } from "@/lib/prisma";
import { autoProgressTicket } from "@/lib/procurement/auto-progress-ticket";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const line = await prisma.ticketLine.findUnique({
      where: { id },
      include: {
        ticket: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
      },
    });
    if (!line) {
      return Response.json({ error: "Ticket line not found" }, { status: 404 });
    }
    return Response.json(line);
  } catch (error) {
    console.error("Failed to get ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to get ticket line" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();

    // Whitelist allowed fields
    const allowed: Record<string, unknown> = {};
    const fields = [
      "description", "normalizedItemName", "productCode", "specification",
      "internalNotes", "qty", "unit", "lineType",
      "expectedCostUnit", "expectedCostTotal", "actualCostTotal",
      "benchmarkUnit", "benchmarkTotal",
      "suggestedSaleUnit", "actualSaleUnit", "actualSaleTotal",
      "expectedMarginTotal", "actualMarginTotal", "varianceTotal",
      "evidenceStatus", "costStatus", "salesStatus",
      "supplierStrategyType", "siteId", "siteCommercialLinkId",
      "supplierId", "supplierName", "supplierReference",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }

    // Auto-calculate totals if unit prices change
    const current = await prisma.ticketLine.findUnique({ where: { id }, select: { qty: true, expectedCostUnit: true, suggestedSaleUnit: true, actualSaleUnit: true } });
    if (!current) return Response.json({ error: "Not found" }, { status: 404 });

    const qty = Number(allowed.qty ?? current.qty);
    const expectedCostUnit = Number(allowed.expectedCostUnit ?? current.expectedCostUnit ?? 0);
    const suggestedSaleUnit = Number(allowed.suggestedSaleUnit ?? current.suggestedSaleUnit ?? 0);
    const actualSaleUnit = Number(allowed.actualSaleUnit ?? current.actualSaleUnit ?? 0);

    // Auto-calculate derived fields
    if (allowed.expectedCostUnit !== undefined || allowed.qty !== undefined) {
      allowed.expectedCostTotal = expectedCostUnit * qty;
    }
    if (allowed.actualSaleUnit !== undefined || allowed.qty !== undefined) {
      allowed.actualSaleTotal = actualSaleUnit * qty;
    }
    if (allowed.suggestedSaleUnit !== undefined || allowed.expectedCostUnit !== undefined) {
      allowed.expectedMarginTotal = (suggestedSaleUnit - expectedCostUnit) * qty;
    }
    if (allowed.actualSaleUnit !== undefined || allowed.expectedCostUnit !== undefined) {
      allowed.actualMarginTotal = (actualSaleUnit - expectedCostUnit) * qty;
      allowed.varianceTotal = (actualSaleUnit - suggestedSaleUnit) * qty;
    }

    // Fix 5: Auto-status progression
    const hasExpectedCost = expectedCostUnit > 0 || Number(allowed.expectedCostTotal || 0) > 0;
    const hasSalePrice = actualSaleUnit > 0 || suggestedSaleUnit > 0;

    if (hasExpectedCost && hasSalePrice) {
      // Both cost and sale present — check if ready for quote
      const hasQty = qty > 0;
      const hasDescription = true; // already required on create
      if (hasQty && hasDescription) {
        allowed.status = "READY_FOR_QUOTE";
      } else {
        allowed.status = "PRICED";
      }
    } else if (hasExpectedCost || hasSalePrice) {
      allowed.status = "PRICED";
    }
    // If neither, stay at current status (don't regress)

    // Don't override manually set status if it's further along
    if (body.status !== undefined) {
      allowed.status = body.status;
    }

    // Auto-create or link supplier when supplierName is set
    if (allowed.supplierName && !allowed.supplierId) {
      const trimmed = allowed.supplierName.trim();
      allowed.supplierName = trimmed;
      // Try exact match first, then contains match for partial names
      const existingSupplier = await prisma.supplier.findFirst({
        where: { name: { equals: trimmed, mode: "insensitive" } },
      }) || await prisma.supplier.findFirst({
        where: { name: { contains: trimmed, mode: "insensitive" } },
      }) || await prisma.supplier.findFirst({
        where: { name: { startsWith: trimmed.split(" ")[0], mode: "insensitive" } },
      });
      if (existingSupplier) {
        allowed.supplierId = existingSupplier.id;
        allowed.supplierName = existingSupplier.name; // Use canonical name
      } else {
        const newSupplier = await prisma.supplier.create({
          data: { name: trimmed },
        });
        allowed.supplierId = newSupplier.id;
      }
    }

    const line = await prisma.ticketLine.update({
      where: { id },
      data: allowed,
      select: { id: true, ticketId: true, status: true, description: true, qty: true, unit: true, expectedCostUnit: true, expectedCostTotal: true, actualCostTotal: true, actualSaleUnit: true, actualSaleTotal: true, suggestedSaleUnit: true, expectedMarginTotal: true, actualMarginTotal: true, varianceTotal: true, normalizedItemName: true, productCode: true, specification: true, internalNotes: true, lineType: true, benchmarkUnit: true, benchmarkTotal: true, evidenceStatus: true, costStatus: true, salesStatus: true, supplierStrategyType: true, siteId: true, siteCommercialLinkId: true, supplierId: true, supplierName: true, supplierReference: true, sectionLabel: true, payingCustomerId: true },
    });

    // Auto-progress ticket status when lines change
    if (allowed.status === "ORDERED" || allowed.status === "FROM_STOCK" || allowed.status === "FULLY_COSTED" || allowed.status === "INVOICED") {
      await autoProgressTicket(line.ticketId);
    }

    return Response.json(line);
  } catch (error) {
    console.error("Failed to update ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update ticket line" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Check for hard dependencies that block deletion
    const invoiceLines = await prisma.salesInvoiceLine.count({ where: { ticketLineId: id } });

    if (invoiceLines > 0) {
      return Response.json({
        error: "Cannot delete — line has invoice lines. Remove those first.",
        invoiceLines,
      }, { status: 409 });
    }

    // Clean up soft dependencies before deleting
    // Also clean up BOM component lines if this is a BOM parent
    await prisma.$transaction([
      // Clean up dependencies on component lines (if BOM parent)
      prisma.costAllocation.deleteMany({ where: { ticketLine: { parentLineId: id } } }),
      prisma.stockUsage.deleteMany({ where: { ticketLine: { parentLineId: id } } }),
      prisma.quoteLine.deleteMany({ where: { ticketLine: { parentLineId: id } } }),
      prisma.procurementOrderLine.updateMany({ where: { ticketLine: { parentLineId: id } }, data: { ticketLineId: null } }),
      prisma.ticketLine.deleteMany({ where: { parentLineId: id } }),
      // Clean up dependencies on the parent line itself
      prisma.costAllocation.deleteMany({ where: { ticketLineId: id } }),
      prisma.stockUsage.deleteMany({ where: { ticketLineId: id } }),
      prisma.quoteLine.deleteMany({ where: { ticketLineId: id } }),
      prisma.procurementOrderLine.updateMany({ where: { ticketLineId: id }, data: { ticketLineId: null } }),
      prisma.ticketLine.delete({ where: { id } }),
    ]);

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete ticket line" }, { status: 500 });
  }
}

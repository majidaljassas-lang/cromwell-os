import { prisma } from "@/lib/prisma";

/**
 * POST /api/commercial/invoices/[id]/allocate
 *
 * Allocate an invoice line to an order group.
 * All invoice lines start as UNALLOCATED — nothing is assumed linked.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const body = await request.json();
    const { invoiceLineId, orderGroupId, allocatedQty, confidence, manualOverride, notes } = body;

    if (!invoiceLineId || !orderGroupId || allocatedQty === undefined) {
      return Response.json(
        { error: "invoiceLineId, orderGroupId, allocatedQty are required" },
        { status: 400 }
      );
    }

    // Verify the invoice line belongs to this invoice
    const line = await prisma.commercialInvoiceLine.findUnique({
      where: { id: invoiceLineId },
    });

    if (!line || line.commercialInvoiceId !== invoiceId) {
      return Response.json({ error: "Invoice line not found on this invoice" }, { status: 404 });
    }

    // Verify order group exists
    const group = await prisma.orderGroup.findUnique({
      where: { id: orderGroupId },
    });
    if (!group) {
      return Response.json({ error: "Order group not found" }, { status: 404 });
    }

    // Create the allocation
    const allocation = await prisma.invoiceLineAllocation.create({
      data: {
        commercialInvoiceLineId: invoiceLineId,
        orderGroupId,
        allocatedQty,
        confidence,
        manualOverride: manualOverride || false,
        notes,
      },
    });

    // Calculate total allocated qty for this line
    const allAllocations = await prisma.invoiceLineAllocation.findMany({
      where: { commercialInvoiceLineId: invoiceLineId },
    });

    const totalAllocated = allAllocations.reduce(
      (sum, a) => sum + Number(a.allocatedQty),
      0
    );
    const lineQty = line.uomResolved ? Number(line.normalisedQty) : Number(line.qty);

    // Update allocation status
    let allocationStatus: "UNALLOCATED" | "PARTIALLY_ALLOCATED" | "ALLOCATED" = "UNALLOCATED";
    if (totalAllocated >= lineQty) {
      allocationStatus = "ALLOCATED";
    } else if (totalAllocated > 0) {
      allocationStatus = "PARTIALLY_ALLOCATED";
    }

    await prisma.commercialInvoiceLine.update({
      where: { id: invoiceLineId },
      data: {
        allocationStatus,
        allocationConfidence: confidence,
        manualOverride: manualOverride || false,
      },
    });

    // Update order group billed qty
    const groupAllocations = await prisma.invoiceLineAllocation.findMany({
      where: { orderGroupId },
    });
    const billedQty = groupAllocations.reduce(
      (sum, a) => sum + Number(a.allocatedQty),
      0
    );
    await prisma.orderGroup.update({
      where: { id: orderGroupId },
      data: { billedQty },
    });

    return Response.json(allocation, { status: 201 });
  } catch (error) {
    console.error("Failed to allocate invoice line:", error);
    return Response.json({ error: "Failed to allocate invoice line" }, { status: 500 });
  }
}

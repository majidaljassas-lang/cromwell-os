import { prisma } from "@/lib/prisma";

/**
 * GET /api/tickets/[id]/order-reconciliation
 * Returns all PO lines with their match status and ticket line mappings
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const poLines = await prisma.procurementOrderLine.findMany({
      where: { procurementOrder: { ticketId } },
      include: {
        procurementOrder: { select: { poNo: true, supplier: { select: { name: true } } } },
        ticketLine: { select: { id: true, description: true, qty: true, unit: true } },
      },
      orderBy: { procurementOrder: { poNo: "asc" } },
    });

    const ticketLines = await prisma.ticketLine.findMany({
      where: { ticketId },
      select: { id: true, description: true, qty: true, unit: true, status: true },
      orderBy: { createdAt: "asc" },
    });

    // Find unmatched ticket lines (no PO line points to them)
    const matchedTlIds = new Set(poLines.filter(pl => pl.ticketLineId).map(pl => pl.ticketLineId));
    const unmatchedTicketLines = ticketLines.filter(tl => !matchedTlIds.has(tl.id));

    return Response.json({
      poLines,
      ticketLines,
      unmatchedTicketLines,
      summary: {
        totalPoLines: poLines.length,
        matched: poLines.filter(pl => pl.matchStatus === "MATCHED").length,
        matchedWithExcess: poLines.filter(pl => pl.matchStatus === "MATCHED_WITH_EXCESS").length,
        unmatched: poLines.filter(pl => pl.matchStatus === "UNMATCHED").length,
        deliveryCost: poLines.filter(pl => pl.matchStatus === "DELIVERY_COST").length,
        unmatchedTicketLines: unmatchedTicketLines.length,
      },
    });
  } catch (error) {
    console.error("Failed to get reconciliation:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * PATCH /api/tickets/[id]/order-reconciliation
 * Manual match/unmatch/allocate actions
 * Body: { action, poLineId, ticketLineId?, matchStatus? }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const { action, poLineId, ticketLineId, matchStatus } = await request.json();

    if (action === "match" && poLineId && ticketLineId) {
      await prisma.procurementOrderLine.update({
        where: { id: poLineId },
        data: { ticketLineId, matchStatus: "MATCHED" },
      });
      return Response.json({ ok: true });
    }

    if (action === "unmatch" && poLineId) {
      await prisma.procurementOrderLine.update({
        where: { id: poLineId },
        data: { ticketLineId: null, matchStatus: "UNMATCHED" },
      });
      return Response.json({ ok: true });
    }

    if (action === "allocate_stock" && poLineId) {
      const poLine = await prisma.procurementOrderLine.findUnique({
        where: { id: poLineId },
        include: {
          ticketLine: { select: { qty: true, unit: true, description: true } },
          procurementOrder: { select: { poNo: true, ticketId: true, supplier: { select: { name: true } }, ticket: { select: { title: true } } } },
        },
      });
      if (!poLine) return Response.json({ error: "PO line not found" }, { status: 404 });

      const orderedQty = Number(poLine.qty);
      const unitCost = Number(poLine.unitCost);
      let requiredQty = 0;

      if (poLine.ticketLine) {
        requiredQty = Number(poLine.ticketLine.qty);
        if (poLine.ticketLine.unit === "PACK") {
          const packMatch = poLine.ticketLine.description.match(/\((\d+)\)/);
          if (packMatch) requiredQty = requiredQty * parseInt(packMatch[1]);
        }
      }

      const excessQty = Math.max(0, orderedQty - requiredQty);
      const usedCost = requiredQty * unitCost;
      const excessCost = excessQty * unitCost;

      if (excessQty > 0) {
        await prisma.stockExcessRecord.create({
          data: {
            ticketLineId: poLine.ticketLineId,
            description: poLine.description,
            excessQty,
            purchasedCost: Number(poLine.lineTotal),
            usedCost,
            excessCost,
            treatment: "STOCK",
            status: "ALLOCATED",
          },
        });

        // Auto-create StockItem for the excess
        await prisma.stockItem.create({
          data: {
            description: poLine.description,
            qtyOnHand: excessQty,
            qtyOriginal: excessQty,
            unit: poLine.ticketLine?.unit ?? "EA",
            costPerUnit: unitCost,
            sourceType: "MOQ_EXCESS",
            supplierName: poLine.procurementOrder.supplier.name,
            originTicketId: poLine.procurementOrder.ticketId,
            originTicketTitle: poLine.procurementOrder.ticket.title,
            originBillNo: poLine.procurementOrder.poNo,
            notes: `Ordered ${orderedQty}, needed ${requiredQty} — ${excessQty} excess from MOQ`,
          },
        });
      }

      await prisma.procurementOrderLine.update({
        where: { id: poLineId },
        data: { matchStatus: "STOCK_ALLOCATED" },
      });
      return Response.json({ ok: true });
    }

    if (action === "update_status" && poLineId && matchStatus) {
      const poLine = await prisma.procurementOrderLine.update({
        where: { id: poLineId },
        data: { matchStatus },
        include: { procurementOrder: { select: { ticketId: true, supplierId: true } } },
      });

      // If absorbing, create an AbsorbedCostAllocation record
      if (matchStatus === "ABSORBED") {
        await prisma.absorbedCostAllocation.create({
          data: {
            ticketId: poLine.procurementOrder.ticketId,
            description: poLine.description,
            amount: poLine.lineTotal,
            allocationBasis: "DELIVERY_CHARGE",
          },
        });
      }

      return Response.json({ ok: true });
    }

    if (action === "flag_short") {
      const { description, shortQty } = body;
      // Create a task to order the shortage
      await prisma.task.create({
        data: {
          ticketId,
          ticketLineId: poLineId, // poLineId is ticketLineId in this context
          taskType: "ORDER_SHORTAGE",
          priority: "HIGH",
          status: "OPEN",
          reason: `Short ${shortQty} x ${description} — needs ordering`,
        },
      });
      // Log event
      await prisma.event.create({
        data: {
          ticketId,
          ticketLineId: poLineId,
          eventType: "TASK_GENERATED",
          timestamp: new Date(),
          notes: `Shortage flagged: ${shortQty} x ${description} — order required`,
        },
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to update reconciliation:", error);
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

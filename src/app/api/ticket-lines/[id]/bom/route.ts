import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const line = await prisma.ticketLine.findUnique({
      where: { id },
      include: {
        components: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!line) {
      return Response.json({ error: "Ticket line not found" }, { status: 404 });
    }
    return Response.json(line);
  } catch (error) {
    console.error("Failed to get BOM:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get BOM" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { components } = body;

    if (!components || !Array.isArray(components) || components.length === 0) {
      return Response.json(
        { error: "components array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Get the parent line
    const parent = await prisma.ticketLine.findUnique({
      where: { id },
      select: {
        id: true,
        ticketId: true,
        lineType: true,
        payingCustomerId: true,
        siteId: true,
        siteCommercialLinkId: true,
        sectionLabel: true,
        qty: true,
        parentLineId: true,
      },
    });

    if (!parent) {
      return Response.json({ error: "Ticket line not found" }, { status: 404 });
    }

    // Prevent nested BOMs — components can't have their own components
    if (parent.parentLineId) {
      return Response.json(
        { error: "Cannot create BOM on a component line — no nested BOMs" },
        { status: 400 }
      );
    }

    // Delete any existing components — clean up dependencies first
    const existingComponentIds = (await prisma.ticketLine.findMany({
      where: { parentLineId: id },
      select: { id: true },
    })).map(c => c.id);

    if (existingComponentIds.length > 0) {
      await prisma.$transaction([
        prisma.costAllocation.deleteMany({ where: { ticketLineId: { in: existingComponentIds } } }),
        prisma.stockUsage.deleteMany({ where: { ticketLineId: { in: existingComponentIds } } }),
        prisma.quoteLine.deleteMany({ where: { ticketLineId: { in: existingComponentIds } } }),
        prisma.procurementOrderLine.updateMany({ where: { ticketLineId: { in: existingComponentIds } }, data: { ticketLineId: null } }),
        prisma.ticketLine.deleteMany({ where: { parentLineId: id } }),
      ]);
    }

    // Calculate parent cost total from component costs
    let parentCostTotal = 0;
    let parentCostUnit = 0;
    const parentQty = Number(parent.qty);

    for (const comp of components) {
      const compQty = Number(comp.qty || 0);
      const compCostUnit = Number(comp.expectedCostUnit || 0);
      parentCostTotal += compQty * compCostUnit;
    }

    if (parentQty > 0) {
      parentCostUnit = parentCostTotal / parentQty;
    }

    // Create all components and update parent in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create child lines
      for (const comp of components) {
        const compQty = Number(comp.qty || 0);
        const compCostUnit = Number(comp.expectedCostUnit || 0);

        // Auto-link supplier if name provided
        let supplierId: string | null = null;
        let supplierName: string | null = comp.supplierName || null;

        if (supplierName) {
          const trimmed = supplierName.trim();
          supplierName = trimmed;
          const existing = await tx.supplier.findFirst({
            where: { name: { equals: trimmed, mode: "insensitive" } },
          });
          if (existing) {
            supplierId = existing.id;
            supplierName = existing.name;
          }
        }

        const childLine = await tx.ticketLine.create({
          data: {
            ticketId: parent.ticketId,
            parentLineId: id,
            lineType: parent.lineType,
            description: comp.description,
            qty: compQty,
            unit: comp.unit || "EA",
            expectedCostUnit: compCostUnit,
            expectedCostTotal: compQty * compCostUnit,
            payingCustomerId: parent.payingCustomerId,
            siteId: parent.siteId,
            siteCommercialLinkId: parent.siteCommercialLinkId,
            sectionLabel: parent.sectionLabel,
            status: comp.stockItemId ? "FROM_STOCK" : "CAPTURED",
            supplierId,
            supplierName,
          },
        });

        // If sourced from stock, allocate and deduct
        if (comp.stockItemId) {
          const stockItem = await tx.stockItem.findUnique({ where: { id: comp.stockItemId } });
          if (stockItem) {
            const costPerUnit = Number(stockItem.costPerUnit);
            await tx.stockUsage.create({
              data: {
                stockItemId: comp.stockItemId,
                ticketLineId: childLine.id,
                qtyUsed: compQty,
                costPerUnit,
                totalCost: costPerUnit * compQty,
                notes: `BOM component for ${parent.sectionLabel || "ticket"} line`,
              },
            });
            // Deduct from stock
            const newQty = Number(stockItem.qtyOnHand) - compQty;
            await tx.stockItem.update({
              where: { id: comp.stockItemId },
              data: {
                qtyOnHand: Math.max(0, newQty),
                outcome: newQty <= 0 ? "ALLOCATED" : "HOLDING",
                outcomeDate: newQty <= 0 ? new Date() : undefined,
              },
            });
          }
        }
      }

      // Update parent: mark as BOM parent and update cost
      const updated = await tx.ticketLine.update({
        where: { id },
        data: {
          isBomParent: true,
          expectedCostUnit: parentCostUnit,
          expectedCostTotal: parentCostTotal,
        },
        include: {
          components: { orderBy: { createdAt: "asc" } },
        },
      });

      return updated;
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create BOM:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create BOM" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const parent = await prisma.ticketLine.findUnique({
      where: { id },
      select: { id: true, isBomParent: true },
    });

    if (!parent) {
      return Response.json({ error: "Ticket line not found" }, { status: 404 });
    }

    if (!parent.isBomParent) {
      return Response.json({ error: "Line is not a BOM parent" }, { status: 400 });
    }

    await prisma.$transaction([
      // Clean up any soft dependencies on component lines before deleting them
      prisma.costAllocation.deleteMany({ where: { ticketLine: { parentLineId: id } } }),
      prisma.stockUsage.deleteMany({ where: { ticketLine: { parentLineId: id } } }),
      prisma.quoteLine.deleteMany({ where: { ticketLine: { parentLineId: id } } }),
      prisma.procurementOrderLine.updateMany({
        where: { ticketLine: { parentLineId: id } },
        data: { ticketLineId: null },
      }),
      // Delete all component lines
      prisma.ticketLine.deleteMany({ where: { parentLineId: id } }),
      // Reset parent
      prisma.ticketLine.update({
        where: { id },
        data: {
          isBomParent: false,
          expectedCostUnit: null,
          expectedCostTotal: null,
        },
      }),
    ]);

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete BOM:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete BOM" },
      { status: 500 }
    );
  }
}

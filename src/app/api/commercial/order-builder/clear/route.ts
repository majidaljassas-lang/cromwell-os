import { prisma } from "@/lib/prisma";

/**
 * POST /api/commercial/order-builder/clear
 * Removes all OrderGroups, OrderEvents, and related review queue items for a site.
 */
export async function POST(request: Request) {
  try {
    const { siteId } = await request.json();
    if (!siteId) return Response.json({ error: "siteId required" }, { status: 400 });

    const groups = await prisma.orderGroup.findMany({
      where: { siteId },
      select: { id: true },
    });
    const groupIds = groups.map((g) => g.id);

    const events = groupIds.length > 0
      ? await prisma.orderEvent.deleteMany({ where: { orderGroupId: { in: groupIds } } })
      : { count: 0 };

    const allocs = groupIds.length > 0
      ? await prisma.invoiceLineAllocation.deleteMany({ where: { orderGroupId: { in: groupIds } } })
      : { count: 0 };

    const deleted = groupIds.length > 0
      ? await prisma.orderGroup.deleteMany({ where: { siteId } })
      : { count: 0 };

    // Clear related review queue items
    const reviewDeleted = await prisma.reviewQueueItem.deleteMany({
      where: { siteId, entityType: "OrderGroup" },
    });

    return Response.json({
      cleared: true,
      groups: deleted.count,
      events: events.count,
      allocations: allocs.count,
      reviewItems: reviewDeleted.count,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

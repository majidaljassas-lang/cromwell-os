import { prisma } from "@/lib/prisma";
import { buildOrders, getDellowConfig } from "@/lib/commercial/order-builder";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET /api/commercial/order-builder?siteId=xxx
 * Returns current order groups with confidence/approval status.
 *
 * POST /api/commercial/order-builder
 * Runs the full Order Builder pipeline.
 * Body: { siteId, caseId, groupChatSourceIds?: string[] }
 *
 * PATCH /api/commercial/order-builder
 * Approval workflow actions.
 * Body: { action: "approve"|"reject"|"exclude"|"mark_not_dellow", groupId, ... }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }

    const groups = await prisma.orderGroup.findMany({
      where: { siteId },
      include: {
        site: true,
        orderEvents: {
          include: { canonicalProduct: true },
          orderBy: { timestamp: "asc" },
        },
      },
    });

    // Sort by earliest event timestamp (most recent first), fallback to createdAt
    groups.sort((a, b) => {
      const aTs = a.orderEvents.length > 0 ? a.orderEvents[0].timestamp.getTime() : a.createdAt.getTime();
      const bTs = b.orderEvents.length > 0 ? b.orderEvents[0].timestamp.getTime() : b.createdAt.getTime();
      return bTs - aTs;
    });

    // Filter out empty groups (no events = failed extraction)
    const nonEmpty = groups.filter((g) => g.orderEvents.length > 0);

    // Categorise
    const autoApproved = nonEmpty.filter((g) => g.approvalStatus === "AUTO_APPROVED" || g.approvalStatus === "APPROVED");
    const needsReview = nonEmpty.filter((g) => g.approvalStatus === "PENDING_REVIEW");
    const excluded = nonEmpty.filter((g) => g.approvalStatus === "EXCLUDED" || g.approvalStatus === "REJECTED");

    return Response.json({
      siteId,
      total: groups.length,
      autoApproved: autoApproved.length,
      needsReview: needsReview.length,
      excluded: excluded.length,
      sections: {
        approved: JSON.parse(JSON.stringify(autoApproved)),
        review: JSON.parse(JSON.stringify(needsReview)),
        excluded: JSON.parse(JSON.stringify(excluded)),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Order builder GET failed:", msg);
    return Response.json({ error: "Failed", detail: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId, caseId, groupChatSourceIds } = body;

    if (!siteId || !caseId) {
      return Response.json({ error: "siteId and caseId are required" }, { status: 400 });
    }

    const config = getDellowConfig(siteId, caseId);
    if (groupChatSourceIds) config.groupChatSourceIds = groupChatSourceIds;

    const result = await buildOrders(config);

    return Response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Order builder failed:", msg);
    return Response.json({ error: "Order builder failed", detail: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action, groupId } = body;

    if (!groupId) {
      return Response.json({ error: "groupId is required" }, { status: 400 });
    }

    switch (action) {
      case "approve": {
        const group = await prisma.orderGroup.update({
          where: { id: groupId },
          data: {
            approvalStatus: "APPROVED",
            approvedBy: body.approvedBy || "system",
            approvedAt: new Date(),
          },
        });
        return Response.json({ updated: groupId, status: "APPROVED" });
      }

      case "reject": {
        await prisma.orderGroup.update({
          where: { id: groupId },
          data: {
            approvalStatus: "REJECTED",
            rejectionReason: body.reason || "Manually rejected",
          },
        });
        return Response.json({ updated: groupId, status: "REJECTED" });
      }

      case "exclude": {
        await prisma.orderGroup.update({
          where: { id: groupId },
          data: { approvalStatus: "EXCLUDED" },
        });
        return Response.json({ updated: groupId, status: "EXCLUDED" });
      }

      case "mark_not_dellow": {
        await prisma.orderGroup.update({
          where: { id: groupId },
          data: {
            siteConfidence: "NOT_THIS_SITE",
            contaminationRisk: "HIGH_RISK",
            approvalStatus: "EXCLUDED",
            rejectionReason: "Marked as not Dellow Centre",
          },
        });
        // Also update all events
        await prisma.orderEvent.updateMany({
          where: { orderGroupId: groupId },
          data: {
            siteConfidence: "NOT_THIS_SITE",
            contaminationRisk: "HIGH_RISK",
          },
        });
        return Response.json({ updated: groupId, status: "EXCLUDED", reason: "NOT_DELLOW" });
      }

      case "split": {
        const { splitAtEventIndex } = body;
        if (splitAtEventIndex === undefined) {
          return Response.json({ error: "splitAtEventIndex required" }, { status: 400 });
        }

        const group = await prisma.orderGroup.findUnique({
          where: { id: groupId },
          include: { orderEvents: { orderBy: { timestamp: "asc" } } },
        });
        if (!group) return Response.json({ error: "Group not found" }, { status: 404 });

        const eventsToMove = group.orderEvents.slice(splitAtEventIndex);
        const newGroup = await prisma.orderGroup.create({
          data: {
            siteId: group.siteId,
            customerId: group.customerId,
            label: `${group.label} (split)`,
            description: `Split from group at event ${splitAtEventIndex}`,
            approvalStatus: "PENDING_REVIEW",
            siteConfidence: group.siteConfidence,
            contaminationRisk: group.contaminationRisk,
            sourceChat: group.sourceChat,
            primarySender: group.primarySender,
          },
        });

        for (const ev of eventsToMove) {
          await prisma.orderEvent.update({
            where: { id: ev.id },
            data: { orderGroupId: newGroup.id },
          });
        }

        return Response.json({ original: groupId, newGroup: newGroup.id });
      }

      case "merge": {
        const { mergeWithGroupId } = body;
        if (!mergeWithGroupId) return Response.json({ error: "mergeWithGroupId required" }, { status: 400 });

        await prisma.orderEvent.updateMany({
          where: { orderGroupId: mergeWithGroupId },
          data: { orderGroupId: groupId },
        });
        await prisma.orderGroup.delete({ where: { id: mergeWithGroupId } });

        return Response.json({ mergedInto: groupId, deleted: mergeWithGroupId });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Order builder PATCH failed:", msg);
    return Response.json({ error: "Failed", detail: msg }, { status: 500 });
  }
}

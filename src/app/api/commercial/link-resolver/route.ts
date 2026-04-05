import { prisma } from "@/lib/prisma";
import { resolveLink, resolveBatch } from "@/lib/ingestion/link-resolver";

/**
 * GET /api/commercial/link-resolver?status=xxx&entityType=xxx&entityId=xxx
 * List InboundEvents with link status, optionally filtered.
 *
 * POST /api/commercial/link-resolver
 * Resolve a single event or batch of backlog messages.
 * Body: { messageIds: string[] } or { event: InboundEventInput }
 *
 * PATCH /api/commercial/link-resolver
 * Override link resolution.
 * Body: { inboundEventId, action: "confirm"|"relink"|"unlink", targetEntityType?, targetEntityId? }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const entityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");
    const siteId = searchParams.get("siteId");
    const limit = parseInt(searchParams.get("limit") || "50");

    const where: Record<string, unknown> = {};
    if (status) where.linkStatus = status;
    if (siteId) where.siteId = siteId;

    // Filter by linked entity
    if (entityType && entityId) {
      switch (entityType) {
        case "Ticket": where.linkedTicketId = entityId; break;
        case "Enquiry": where.linkedEnquiryId = entityId; break;
        case "OrderGroup": where.linkedOrderGroupId = entityId; break;
        case "BacklogCase": where.linkedBacklogCaseId = entityId; break;
      }
    }

    const events = await prisma.inboundEvent.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
    });

    // Summary
    const allEvents = siteId
      ? await prisma.inboundEvent.findMany({
          where: { siteId },
          select: { linkStatus: true },
        })
      : [];

    const summary: Record<string, number> = {};
    for (const e of allEvents) {
      summary[e.linkStatus] = (summary[e.linkStatus] || 0) + 1;
    }

    return Response.json({
      events: JSON.parse(JSON.stringify(events)),
      total: events.length,
      summary,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Batch mode: resolve multiple backlog messages
    if (body.messageIds && Array.isArray(body.messageIds)) {
      const result = await resolveBatch(body.messageIds);
      return Response.json(result);
    }

    // Single event mode
    if (body.event) {
      const result = await resolveLink({
        ...body.event,
        receivedAt: new Date(body.event.receivedAt),
      });
      return Response.json(result);
    }

    // Resolve all recent unprocessed for a site
    if (body.siteId) {
      const backlogCase = await prisma.backlogCase.findFirst({
        where: { siteId: body.siteId },
        include: { sourceGroups: { include: { sources: true } } },
      });
      if (!backlogCase) {
        return Response.json({ error: "No backlog case for site" }, { status: 404 });
      }

      const sourceIds = backlogCase.sourceGroups.flatMap((g) => g.sources.map((s) => s.id));
      const limit = body.limit || 100;

      // Get recent messages not yet processed
      const alreadyProcessed = await prisma.inboundEvent.findMany({
        where: { backlogMessageId: { not: null } },
        select: { backlogMessageId: true },
      });
      const processedIds = new Set(alreadyProcessed.map((e) => e.backlogMessageId));

      const messages = await prisma.backlogMessage.findMany({
        where: {
          sourceId: { in: sourceIds },
          parsedOk: true,
        },
        orderBy: { parsedTimestamp: "desc" },
        take: limit,
        select: { id: true },
      });

      const unprocessedIds = messages
        .map((m) => m.id)
        .filter((id) => !processedIds.has(id));

      if (unprocessedIds.length === 0) {
        return Response.json({ processed: 0, linked: 0, review: 0, newEnquiry: 0, message: "All messages already processed" });
      }

      const result = await resolveBatch(unprocessedIds);
      return Response.json(result);
    }

    return Response.json({ error: "Provide messageIds, event, or siteId" }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { inboundEventId, action } = body;

    if (!inboundEventId || !action) {
      return Response.json({ error: "inboundEventId and action required" }, { status: 400 });
    }

    const event = await prisma.inboundEvent.findUnique({ where: { id: inboundEventId } });
    if (!event) return Response.json({ error: "InboundEvent not found" }, { status: 404 });

    switch (action) {
      case "confirm": {
        // Confirm provisional link as final
        await prisma.inboundEvent.update({
          where: { id: inboundEventId },
          data: {
            linkStatus: "LINKED_HIGH",
            provisionalLink: false,
            resolvedBy: body.resolvedBy || "manual",
            resolvedAt: new Date(),
          },
        });
        return Response.json({ confirmed: true });
      }

      case "relink": {
        // Change link target
        const { targetEntityType, targetEntityId } = body;
        if (!targetEntityType || !targetEntityId) {
          return Response.json({ error: "targetEntityType and targetEntityId required" }, { status: 400 });
        }

        const data: Record<string, unknown> = {
          linkedEntityType: targetEntityType,
          linkedEntityId: targetEntityId,
          linkedTicketId: targetEntityType === "Ticket" ? targetEntityId : null,
          linkedEnquiryId: targetEntityType === "Enquiry" ? targetEntityId : null,
          linkedOrderGroupId: targetEntityType === "OrderGroup" ? targetEntityId : null,
          linkedBacklogCaseId: targetEntityType === "BacklogCase" ? targetEntityId : null,
          linkStatus: "LINKED_HIGH",
          provisionalLink: false,
          overrideEntityId: targetEntityId,
          overrideReason: body.reason || "Manual relink",
          resolvedBy: body.resolvedBy || "manual",
          resolvedAt: new Date(),
        };

        await prisma.inboundEvent.update({ where: { id: inboundEventId }, data });
        return Response.json({ relinked: true, target: targetEntityType });
      }

      case "unlink": {
        await prisma.inboundEvent.update({
          where: { id: inboundEventId },
          data: {
            linkStatus: "NEEDS_REVIEW",
            linkedEntityType: null,
            linkedEntityId: null,
            linkedTicketId: null,
            linkedEnquiryId: null,
            linkedOrderGroupId: null,
            linkedBacklogCaseId: null,
            provisionalLink: false,
            resolvedBy: body.resolvedBy || "manual",
            resolvedAt: new Date(),
          },
        });
        return Response.json({ unlinked: true });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

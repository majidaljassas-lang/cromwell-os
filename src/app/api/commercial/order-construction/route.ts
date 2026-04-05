import { prisma } from "@/lib/prisma";
import { classifyMessage } from "@/lib/commercial/order-classifier";
import { groupOrderEvents, splitGroup, mergeGroups } from "@/lib/commercial/order-grouper";
import { normaliseUom } from "@/lib/commercial/uom";

/**
 * GET /api/commercial/order-construction?siteId=xxx
 * Returns the current state of constructed order groups for a site.
 *
 * POST /api/commercial/order-construction
 * Scans BacklogMessages for a site, classifies, groups, and creates OrderEvents + OrderGroups.
 * Body: { siteId, sourceIds?: string[] }
 *
 * PATCH /api/commercial/order-construction
 * Manual operations: split, merge, reclassify, remove.
 * Body: { action, ... }
 */

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }

    const orderGroups = await prisma.orderGroup.findMany({
      where: { siteId },
      include: {
        site: true,
        orderEvents: {
          include: { canonicalProduct: true },
          orderBy: { timestamp: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      siteId,
      groupCount: orderGroups.length,
      groups: JSON.parse(JSON.stringify(orderGroups)),
    });
  } catch (error) {
    console.error("Failed to get order construction:", error);
    return Response.json({ error: "Failed to get order construction" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId, sourceIds, preview } = body;

    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }

    // Verify site exists
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return Response.json({ error: "Site not found" }, { status: 404 });
    }

    // Find backlog case for this site
    const backlogCase = await prisma.backlogCase.findFirst({
      where: { siteId },
      include: {
        sourceGroups: {
          include: {
            sources: true,
          },
        },
      },
    });

    if (!backlogCase) {
      return Response.json({ error: "No backlog case found for this site" }, { status: 404 });
    }

    // Get all source IDs (WhatsApp only)
    const allSourceIds = backlogCase.sourceGroups
      .flatMap((g) => g.sources)
      .filter((s) => s.sourceType === "WHATSAPP")
      .map((s) => s.id);

    const targetSourceIds = sourceIds && sourceIds.length > 0
      ? sourceIds.filter((id: string) => allSourceIds.includes(id))
      : allSourceIds;

    if (targetSourceIds.length === 0) {
      return Response.json({ error: "No WhatsApp sources found" }, { status: 404 });
    }

    // Fetch all messages from target sources
    const messages = await prisma.backlogMessage.findMany({
      where: {
        sourceId: { in: targetSourceIds },
        parsedOk: true,
      },
      orderBy: { parsedTimestamp: "asc" },
    });

    // Classify each message
    const classified = messages.map((msg) =>
      classifyMessage({
        id: msg.id,
        sourceId: msg.sourceId,
        sender: msg.sender,
        parsedTimestamp: msg.parsedTimestamp.toISOString(),
        rawText: msg.rawText,
        messageType: msg.messageType,
      })
    );

    const orderRelevant = classified.filter((c) => c.isOrderRelevant);

    // Group into order groups
    const proposedGroups = groupOrderEvents(classified);

    // If preview mode, return proposals without persisting
    if (preview) {
      return Response.json({
        siteId,
        siteName: site.siteName,
        totalMessages: messages.length,
        orderRelevant: orderRelevant.length,
        classified: classified.filter((c) => c.isOrderRelevant),
        proposedGroups,
        preview: true,
      });
    }

    // Persist order groups and events
    const createdGroups = [];

    for (const proposed of proposedGroups) {
      // Create the OrderGroup
      const orderGroup = await prisma.orderGroup.create({
        data: {
          siteId,
          label: proposed.label,
          description: `Auto-constructed from ${proposed.events.length} WhatsApp messages. Confidence: ${proposed.confidence}%.${proposed.isUncertain ? " UNCERTAIN — needs review." : ""}`,
        },
      });

      // Create OrderEvents for each event in the group
      for (const event of proposed.events) {
        for (const pl of event.productLines) {
          // Resolve canonical product
          let canonicalProductId: string | null = null;
          if (pl.productCode) {
            const cp = await prisma.canonicalProduct.findUnique({
              where: { code: pl.productCode },
            });
            if (cp) {
              canonicalProductId = cp.id;
            } else {
              // Create review queue item
              await prisma.reviewQueueItem.create({
                data: {
                  queueType: "UNRESOLVED_PRODUCT",
                  description: `Order construction: "${pl.rawText}" normalized to ${pl.productCode} but no canonical product found`,
                  productCode: pl.productCode,
                  siteId,
                  entityId: orderGroup.id,
                  entityType: "OrderGroup",
                  rawValue: pl.rawText,
                },
              });
              continue;
            }
          } else {
            // Unknown product — review queue
            await prisma.reviewQueueItem.create({
              data: {
                queueType: "UNRESOLVED_PRODUCT",
                description: `Order construction: could not normalize "${pl.rawText}"`,
                siteId,
                entityId: orderGroup.id,
                entityType: "OrderGroup",
                rawValue: pl.rawText,
              },
            });
            continue;
          }

          // UOM normalisation
          const product = await prisma.canonicalProduct.findUnique({
            where: { id: canonicalProductId },
          });

          let normalisedQty: number | null = null;
          let canonicalUom: string | null = null;
          let uomResolved = false;

          if (product) {
            const uomResult = await normaliseUom(
              canonicalProductId, pl.qty, pl.rawUom, product.canonicalUom
            );
            normalisedQty = uomResult.normalisedQty;
            canonicalUom = uomResult.canonicalUom;
            uomResolved = uomResult.uomResolved;

            if (!uomResolved) {
              await prisma.reviewQueueItem.create({
                data: {
                  queueType: "UOM_MISMATCH",
                  description: `Order construction: ${product.code} — ${pl.rawUom} cannot convert to ${product.canonicalUom}`,
                  siteId,
                  productCode: product.code,
                  entityId: orderGroup.id,
                  entityType: "OrderGroup",
                  rawValue: `${pl.qty} ${pl.rawUom}`,
                },
              });
            }
          }

          await prisma.orderEvent.create({
            data: {
              orderGroupId: orderGroup.id,
              canonicalProductId,
              siteId,
              eventType: event.eventType as any,
              qty: pl.qty,
              rawUom: pl.rawUom,
              normalisedQty,
              canonicalUom,
              uomResolved,
              sourceMessageId: event.messageId,
              sourceText: pl.rawText,
              timestamp: new Date(event.timestamp),
            },
          });
        }
      }

      // Flag uncertain groups for review
      if (proposed.isUncertain) {
        await prisma.reviewQueueItem.create({
          data: {
            queueType: "MISSING_ORDER_EVIDENCE",
            description: `Uncertain order group: ${proposed.label}. Reasons: ${proposed.uncertainReasons.join("; ")}`,
            siteId,
            entityId: orderGroup.id,
            entityType: "OrderGroup",
          },
        });
      }

      // Recalculate order group totals
      const events = await prisma.orderEvent.findMany({
        where: { orderGroupId: orderGroup.id },
      });

      let orderedQty = 0;
      for (const oe of events) {
        const qty = oe.uomResolved ? Number(oe.normalisedQty) : Number(oe.qty);
        switch (oe.eventType) {
          case "INITIAL_ORDER":
          case "ADDITION":
          case "SUBSTITUTION_IN":
          case "CONFIRMATION":
            orderedQty += qty;
            break;
          case "REDUCTION":
          case "SUBSTITUTION_OUT":
          case "CANCELLATION":
            orderedQty -= qty;
            break;
        }
      }

      await prisma.orderGroup.update({
        where: { id: orderGroup.id },
        data: { orderedQty: Math.max(0, orderedQty) },
      });

      // Fetch full group for response
      const fullGroup = await prisma.orderGroup.findUnique({
        where: { id: orderGroup.id },
        include: {
          orderEvents: { include: { canonicalProduct: true }, orderBy: { timestamp: "asc" } },
        },
      });

      createdGroups.push(fullGroup);
    }

    return Response.json({
      siteId,
      siteName: site.siteName,
      totalMessages: messages.length,
      orderRelevant: orderRelevant.length,
      groupsCreated: createdGroups.length,
      groups: JSON.parse(JSON.stringify(createdGroups)),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Order construction failed:", msg);
    return Response.json({ error: "Order construction failed", detail: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case "split": {
        const { groupId, splitAtEventIndex } = body;
        if (!groupId || splitAtEventIndex === undefined) {
          return Response.json({ error: "groupId and splitAtEventIndex required" }, { status: 400 });
        }

        const group = await prisma.orderGroup.findUnique({
          where: { id: groupId },
          include: {
            orderEvents: { orderBy: { timestamp: "asc" } },
          },
        });
        if (!group) {
          return Response.json({ error: "Group not found" }, { status: 404 });
        }

        // Create new group for the split-off events
        const eventsToMove = group.orderEvents.slice(splitAtEventIndex);
        const newGroup = await prisma.orderGroup.create({
          data: {
            siteId: group.siteId,
            label: `${group.label} (split)`,
            description: `Split from group ${group.id} at event index ${splitAtEventIndex}`,
          },
        });

        // Move events to new group
        for (const ev of eventsToMove) {
          await prisma.orderEvent.update({
            where: { id: ev.id },
            data: { orderGroupId: newGroup.id },
          });
        }

        // Recalculate both groups
        await recalcGroupTotals(groupId);
        await recalcGroupTotals(newGroup.id);

        return Response.json({ original: groupId, newGroup: newGroup.id });
      }

      case "merge": {
        const { groupIdA, groupIdB } = body;
        if (!groupIdA || !groupIdB) {
          return Response.json({ error: "groupIdA and groupIdB required" }, { status: 400 });
        }

        // Move all events from B to A
        await prisma.orderEvent.updateMany({
          where: { orderGroupId: groupIdB },
          data: { orderGroupId: groupIdA },
        });

        // Delete group B
        await prisma.orderGroup.delete({ where: { id: groupIdB } });

        // Recalculate merged group
        await recalcGroupTotals(groupIdA);

        return Response.json({ mergedInto: groupIdA, deleted: groupIdB });
      }

      case "reclassify": {
        const { eventId, newEventType } = body;
        if (!eventId || !newEventType) {
          return Response.json({ error: "eventId and newEventType required" }, { status: 400 });
        }

        const event = await prisma.orderEvent.update({
          where: { id: eventId },
          data: { eventType: newEventType },
        });

        await recalcGroupTotals(event.orderGroupId);

        return Response.json({ updated: event.id, newType: newEventType });
      }

      case "remove": {
        const { eventId: removeId } = body;
        if (!removeId) {
          return Response.json({ error: "eventId required" }, { status: 400 });
        }

        const event = await prisma.orderEvent.delete({
          where: { id: removeId },
        });

        await recalcGroupTotals(event.orderGroupId);

        return Response.json({ removed: removeId });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Order construction PATCH failed:", msg);
    return Response.json({ error: "Failed", detail: msg }, { status: 500 });
  }
}

async function recalcGroupTotals(groupId: string) {
  const events = await prisma.orderEvent.findMany({
    where: { orderGroupId: groupId },
  });

  let orderedQty = 0;
  for (const oe of events) {
    const qty = oe.uomResolved ? Number(oe.normalisedQty) : Number(oe.qty);
    switch (oe.eventType) {
      case "INITIAL_ORDER":
      case "ADDITION":
      case "SUBSTITUTION_IN":
      case "CONFIRMATION":
        orderedQty += qty;
        break;
      case "REDUCTION":
      case "SUBSTITUTION_OUT":
      case "CANCELLATION":
        orderedQty -= qty;
        break;
    }
  }

  await prisma.orderGroup.update({
    where: { id: groupId },
    data: { orderedQty: Math.max(0, orderedQty) },
  });
}

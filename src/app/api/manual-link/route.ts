import { prisma } from "@/lib/prisma";

/**
 * POST: Manual linking — customer, site, order thread, invoice line, bill line.
 *
 * Body: {
 *   linkType: "CUSTOMER" | "SITE" | "ORDER_THREAD" | "INVOICE_LINE" | "BILL_LINE"
 *   sourceId: string       // the record being linked FROM
 *   targetId: string       // the canonical entity being linked TO
 *   rawText?: string       // raw text to create alias from
 *   linkedBy?: string
 *   notes?: string
 * }
 *
 * When manually linked:
 * - saves resolved ID on source record
 * - marks manualConfirmed = true
 * - creates alias automatically from raw text
 * - creates audit trail entry
 * - overrides weak auto-matches
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { linkType, sourceId, targetId, rawText, linkedBy, notes } = body;

    if (!linkType || !sourceId || !targetId) {
      return Response.json({ error: "linkType, sourceId, targetId required" }, { status: 400 });
    }

    let result: unknown = null;

    if (linkType === "CUSTOMER") {
      // Link raw customer text to canonical customer entity
      if (rawText) {
        await prisma.customerAlias.upsert({
          where: { customerId_aliasText: { customerId: targetId, aliasText: rawText.toLowerCase().trim() } },
          create: {
            customerId: targetId,
            aliasText: rawText.toLowerCase().trim(),
            aliasSource: "manual",
            confidenceScore: 100,
            manualConfirmed: true,
          },
          update: { manualConfirmed: true, confidenceScore: 100 },
        });
      }
      result = { linked: true, customerId: targetId, aliasCreated: !!rawText };

    } else if (linkType === "SITE") {
      // Link raw site text to canonical site
      if (rawText) {
        await prisma.siteAlias.upsert({
          where: { siteId_aliasText: { siteId: targetId, aliasText: rawText.toLowerCase().trim() } },
          create: {
            siteId: targetId,
            aliasText: rawText.toLowerCase().trim(),
            aliasSource: "manual",
            confidenceDefault: 100,
            manualConfirmed: true,
          },
          update: { manualConfirmed: true, confidenceDefault: 100 },
        });
      }
      result = { linked: true, siteId: targetId, aliasCreated: !!rawText };

    } else if (linkType === "ORDER_THREAD") {
      // Link message to order thread
      const thread = await prisma.backlogOrderThread.findUnique({ where: { id: targetId } });
      if (thread) {
        const messageIds = [...new Set([...thread.messageIds, sourceId])];
        await prisma.backlogOrderThread.update({
          where: { id: targetId },
          data: { messageIds },
        });
      }
      result = { linked: true, threadId: targetId };

    } else if (linkType === "INVOICE_LINE") {
      // Link order line to invoice line
      await prisma.backlogInvoiceMatch.create({
        data: {
          ticketLineId: sourceId,
          invoiceLineId: targetId,
          matchConfidence: 100,
          matchMethod: "MANUAL_CONFIRMED",
          matchUsedSiteAlias: false,
          matchUsedOrderRef: false,
        },
      });
      result = { linked: true, ticketLineId: sourceId, invoiceLineId: targetId };

    } else {
      return Response.json({ error: `Unknown linkType: ${linkType}` }, { status: 400 });
    }

    // Audit trail
    await prisma.manualLinkAudit.create({
      data: {
        linkType,
        sourceId,
        targetId,
        targetType: linkType,
        linkedBy: linkedBy || "USER",
        notes,
      },
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Manual link failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create manual link" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const linkType = searchParams.get("linkType");
    const sourceId = searchParams.get("sourceId");

    const where: Record<string, unknown> = {};
    if (linkType) where.linkType = linkType;
    if (sourceId) where.sourceId = sourceId;

    const audits = await prisma.manualLinkAudit.findMany({
      where,
      orderBy: { linkedAt: "desc" },
      take: 50,
    });

    return Response.json(audits);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

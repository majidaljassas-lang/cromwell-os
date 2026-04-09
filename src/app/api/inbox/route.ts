import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sourceFilter = url.searchParams.get("source") || "ALL";
    const statusFilter = url.searchParams.get("status") || "ALL";

    // Fetch IngestionEvents that need action
    const ingestionWhere: Record<string, unknown> = {
      status: {
        in: ["PARSED", "CLASSIFIED", "NEEDS_TRIAGE"],
      },
    };

    if (statusFilter === "DISMISSED") {
      ingestionWhere.status = "DISMISSED";
    } else if (statusFilter === "NEEDS_ACTION") {
      // default filter already handles this
    }

    const ingestionEvents = await prisma.ingestionEvent.findMany({
      where: statusFilter === "DISMISSED"
        ? { status: "DISMISSED" }
        : { status: { in: ["PARSED", "CLASSIFIED", "NEEDS_TRIAGE"] } },
      include: {
        source: true,
        parsedMessages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: {
            extractedEntities: true,
          },
        },
      },
      orderBy: { receivedAt: "desc" },
    });

    // Fetch InquiryWorkItems not yet converted/dismissed
    const workItemWhere: Record<string, unknown> = {};
    if (statusFilter === "DISMISSED") {
      workItemWhere.status = { in: ["CLOSED_LOST", "CLOSED_NO_ACTION"] };
    } else if (statusFilter === "NEEDS_ACTION") {
      workItemWhere.status = {
        notIn: ["CONVERTED", "CLOSED_LOST", "CLOSED_NO_ACTION"],
      };
    } else {
      // ALL: show non-converted
      workItemWhere.status = {
        notIn: ["CONVERTED"],
      };
    }

    const workItems = await prisma.inquiryWorkItem.findMany({
      where: workItemWhere,
      include: {
        enquiry: {
          include: {
            suggestedSite: true,
            suggestedCustomer: true,
          },
        },
        site: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
    });

    // Normalize into unified items
    type UnifiedItem = {
      id: string;
      itemType: "INGESTION" | "WORK_ITEM";
      sourceType: string;
      subject: string;
      rawText: string | null;
      suggestedSiteName: string | null;
      suggestedCustomerName: string | null;
      classification: string | null;
      confidenceScore: number | null;
      receivedAt: string;
      status: string;
      customerId: string | null;
      siteId: string | null;
      enquiryId: string | null;
    };

    const unified: UnifiedItem[] = [];

    for (const ev of ingestionEvents) {
      const parsed = ev.parsedMessages[0];
      const sourceType = ev.source?.sourceType || "EMAIL";

      // Apply source filter
      if (sourceFilter !== "ALL") {
        const mappedSource =
          sourceType === "OUTLOOK" ? "EMAIL" : sourceType;
        if (mappedSource !== sourceFilter) continue;
      }

      // Extract classification and suggested entities from parsed data
      let classification: string | null = null;
      let suggestedSiteName: string | null = null;
      let suggestedCustomerName: string | null = null;
      let subject = "";
      let rawText: string | null = null;

      if (parsed) {
        const structured = parsed.structuredData as Record<string, unknown> | null;
        classification = (structured?.classification as string) || parsed.messageType || null;
        subject = (structured?.subject as string) || parsed.extractedText?.substring(0, 120) || "";
        rawText = parsed.extractedText || null;

        for (const entity of parsed.extractedEntities) {
          if (entity.entityType === "SITE" && entity.normalizedValue) {
            suggestedSiteName = suggestedSiteName || entity.normalizedValue;
          }
          if (entity.entityType === "CUSTOMER" && entity.normalizedValue) {
            suggestedCustomerName = suggestedCustomerName || entity.normalizedValue;
          }
        }
      } else {
        const raw = ev.rawPayload as Record<string, unknown> | null;
        subject = (raw?.subject as string) || (raw?.description as string) || "Ingestion Event";
        rawText = (raw?.body as string) || (raw?.text as string) || null;
      }

      unified.push({
        id: ev.id,
        itemType: "INGESTION",
        sourceType,
        subject,
        rawText,
        suggestedSiteName,
        suggestedCustomerName,
        classification,
        confidenceScore: parsed?.confidenceScore ? Number(parsed.confidenceScore) : null,
        receivedAt: ev.receivedAt.toISOString(),
        status: ev.status,
        customerId: null,
        siteId: null,
        enquiryId: null,
      });
    }

    for (const wi of workItems) {
      const sourceType = wi.enquiry?.sourceType || "MANUAL";

      // Apply source filter
      if (sourceFilter !== "ALL") {
        const mappedSource =
          sourceType === "OUTLOOK" ? "EMAIL" : sourceType;
        if (mappedSource !== sourceFilter) continue;
      }

      unified.push({
        id: wi.id,
        itemType: "WORK_ITEM",
        sourceType,
        subject: wi.enquiry?.subjectOrLabel || wi.notes || "Work Item",
        rawText: wi.enquiry?.rawText || null,
        suggestedSiteName: wi.site?.siteName || wi.enquiry?.suggestedSite?.siteName || null,
        suggestedCustomerName: wi.customer?.name || wi.enquiry?.suggestedCustomer?.name || null,
        classification: wi.mode || null,
        confidenceScore: wi.confidenceScore ? Number(wi.confidenceScore) : null,
        receivedAt: wi.createdAt.toISOString(),
        status: wi.status,
        customerId: wi.customerId,
        siteId: wi.siteId,
        enquiryId: wi.enquiryId,
      });
    }

    // Sort by date, newest first
    unified.sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );

    // Compute summary counts
    const summary = {
      total: unified.length,
      email: unified.filter(
        (i) => i.sourceType === "EMAIL" || i.sourceType === "OUTLOOK"
      ).length,
      whatsapp: unified.filter((i) => i.sourceType === "WHATSAPP").length,
      manual: unified.filter((i) => i.sourceType === "MANUAL").length,
      needsTriage: unified.filter(
        (i) => i.status === "NEEDS_TRIAGE" || i.status === "NEW_ENQUIRY"
      ).length,
    };

    return Response.json({ items: unified, summary });
  } catch (error) {
    console.error("Failed to fetch inbox:", error);
    return Response.json(
      { error: "Failed to fetch inbox" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { subject, description, sourceType } = body;

    if (!subject) {
      return Response.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    // Find or create a MANUAL ingestion source
    let manualSource = await prisma.ingestionSource.findFirst({
      where: { sourceType: "MANUAL" },
    });

    if (!manualSource) {
      manualSource = await prisma.ingestionSource.create({
        data: {
          sourceType: "MANUAL",
          accountName: "Manual Entry",
          isActive: true,
        },
      });
    }

    const event = await prisma.ingestionEvent.create({
      data: {
        sourceId: manualSource.id,
        externalMessageId: `manual-${Date.now()}`,
        eventKind: "MANUAL_ENTRY",
        rawPayload: {
          subject,
          description: description || "",
          sourceType: sourceType || "MANUAL",
        },
        receivedAt: new Date(),
        status: "NEEDS_TRIAGE",
      },
    });

    return Response.json(event, { status: 201 });
  } catch (error) {
    console.error("Failed to create manual inbox item:", error);
    return Response.json(
      { error: "Failed to create inbox item" },
      { status: 500 }
    );
  }
}

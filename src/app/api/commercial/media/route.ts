import { prisma } from "@/lib/prisma";
import { scanForMedia, processMediaEvidence } from "@/lib/commercial/media-processor";

/**
 * GET /api/commercial/media?siteId=xxx
 * List MediaEvidence records for a site, with filtering by status/role.
 *
 * POST /api/commercial/media
 * Scan BacklogMessages for a case and create MediaEvidence records.
 * Body: { siteId, caseId }
 *
 * PATCH /api/commercial/media
 * Update a MediaEvidence record (classify, extract, link, exclude).
 * Body: { id, action, ... }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    const status = searchParams.get("status");
    const role = searchParams.get("role");

    const where: Record<string, unknown> = {};
    if (siteId) where.siteId = siteId;
    if (status) where.processingStatus = status;
    if (role) where.evidenceRole = role;

    const media = await prisma.mediaEvidence.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    // Summary counts
    const allMedia = siteId
      ? await prisma.mediaEvidence.findMany({ where: { siteId }, select: { processingStatus: true, evidenceRole: true, mediaType: true } })
      : [];

    const byStatus: Record<string, number> = {};
    const byRole: Record<string, number> = {};
    const byType: Record<string, number> = {};
    for (const m of allMedia) {
      byStatus[m.processingStatus] = (byStatus[m.processingStatus] || 0) + 1;
      byRole[m.evidenceRole] = (byRole[m.evidenceRole] || 0) + 1;
      byType[m.mediaType] = (byType[m.mediaType] || 0) + 1;
    }

    // Completeness
    const completeness = siteId
      ? await prisma.backlogCompleteness.findFirst({
          where: { caseId: { not: undefined } },
          orderBy: { updatedAt: "desc" },
        })
      : null;

    return Response.json({
      items: JSON.parse(JSON.stringify(media)),
      total: allMedia.length,
      byStatus,
      byRole,
      byType,
      completeness: completeness ? JSON.parse(JSON.stringify(completeness)) : null,
    });
  } catch (error) {
    console.error("Failed to list media evidence:", error);
    return Response.json({ error: "Failed to list media evidence" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId, caseId } = body;

    if (!siteId || !caseId) {
      return Response.json({ error: "siteId and caseId are required" }, { status: 400 });
    }

    const result = await scanForMedia(caseId, siteId);

    return Response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Media scan failed:", msg);
    return Response.json({ error: "Media scan failed", detail: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id) {
      return Response.json({ error: "id is required" }, { status: 400 });
    }

    switch (action) {
      case "classify": {
        const { evidenceRole, confidence, classificationNotes } = body;
        if (!evidenceRole) {
          return Response.json({ error: "evidenceRole is required" }, { status: 400 });
        }
        await prisma.mediaEvidence.update({
          where: { id },
          data: {
            evidenceRole,
            roleConfidence: confidence || "MEDIUM",
            classificationNotes,
            processingStatus: "CLASSIFIED",
          },
        });
        return Response.json({ updated: id, action: "classify" });
      }

      case "extract": {
        const { extractedText, evidenceRole, confidence } = body;
        await processMediaEvidence(id, extractedText, evidenceRole || "UNKNOWN_MEDIA", confidence || "LOW");
        return Response.json({ updated: id, action: "extract" });
      }

      case "link": {
        const { orderGroupId } = body;
        if (!orderGroupId) {
          return Response.json({ error: "orderGroupId is required" }, { status: 400 });
        }
        await prisma.mediaEvidence.update({
          where: { id },
          data: {
            orderGroupId,
            processingStatus: "LINKED",
          },
        });
        return Response.json({ updated: id, action: "link" });
      }

      case "exclude": {
        await prisma.mediaEvidence.update({
          where: { id },
          data: { processingStatus: "EXCLUDED" },
        });
        return Response.json({ updated: id, action: "exclude" });
      }

      default:
        return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Media PATCH failed:", msg);
    return Response.json({ error: "Failed", detail: msg }, { status: 500 });
  }
}

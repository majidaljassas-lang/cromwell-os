import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

/**
 * Site Resolution Actions
 * PATCH: confirm match, reject, or create new site
 *
 * Actions:
 * - confirm: set matchedSiteId, reviewStatus = CONFIRMED, optionally create alias
 * - reject: set reviewStatus = REJECTED
 * - create_site: create new canonical site, set matchedSiteId, create alias
 * - not_a_site: mark as REJECTED with reason
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, siteId, createAlias, siteData, reason, actor } = body as {
      action: "confirm" | "reject" | "create_site" | "not_a_site";
      siteId?: string;
      createAlias?: boolean;
      siteData?: { siteName: string; siteCode?: string; addressLine1?: string; city?: string; postcode?: string };
      reason?: string;
      actor?: string;
    };

    const match = await prisma.sourceSiteMatch.findUnique({ where: { id } });
    if (!match) {
      return Response.json({ error: "Match not found" }, { status: 404 });
    }

    const previousStatus = match.reviewStatus;

    if (action === "confirm") {
      if (!siteId) return Response.json({ error: "siteId required for confirm" }, { status: 400 });

      // Block confirmation of compound entries — must resolve individual fragments
      if (match.matchMethod === "MIXED_SITE_COMPOUND") {
        return Response.json({
          error: "Cannot confirm a compound site reference. Resolve individual site fragments instead, then assign lines to sites during commercialisation.",
        }, { status: 422 });
      }

      await prisma.sourceSiteMatch.update({
        where: { id },
        data: {
          matchedSiteId: siteId,
          matchMethod: match.matchMethod === "MIXED_SITE_SPLIT" ? "MIXED_SITE_FRAGMENT_CONFIRMED" : "MANUAL_CONFIRM",
          reviewStatus: "CONFIRMED",
          reviewedBy: actor,
          reviewedAt: new Date(),
        },
      });

      // Create alias only for non-compound, non-mixed entries
      if (createAlias !== false && match.matchMethod !== "MIXED_SITE_SPLIT") {
        await prisma.siteAlias.upsert({
          where: { siteId_aliasText: { siteId, aliasText: match.rawSiteText.toLowerCase().trim() } },
          create: {
            siteId,
            aliasText: match.rawSiteText.toLowerCase().trim(),
            sourceType: match.sourceSystem as "WHATSAPP" | "OUTLOOK" | "ZOHO_BOOKS" | "EMAIL" | "PDF_UPLOAD" | "IMAGE_UPLOAD" | "MANUAL" | "API",
            confidenceDefault: 90,
          },
          update: { isActive: true },
        });
      }

      // Auto-resolve other unresolved matches with same raw text
      // BUT NOT compound entries — those must always be resolved individually
      await prisma.sourceSiteMatch.updateMany({
        where: {
          rawSiteText: { equals: match.rawSiteText, mode: "insensitive" },
          reviewStatus: "UNRESOLVED",
          matchMethod: { notIn: ["MIXED_SITE_COMPOUND", "MIXED_SITE_SPLIT"] },
          id: { not: id },
        },
        data: {
          matchedSiteId: siteId,
          matchMethod: "AUTO_FROM_ALIAS",
          reviewStatus: "CONFIRMED",
          reviewedBy: "SYSTEM",
          reviewedAt: new Date(),
        },
      });

    } else if (action === "create_site") {
      if (!siteData?.siteName) return Response.json({ error: "siteData.siteName required" }, { status: 400 });

      const newSite = await prisma.site.create({
        data: {
          siteName: siteData.siteName,
          siteCode: siteData.siteCode,
          addressLine1: siteData.addressLine1,
          city: siteData.city,
          postcode: siteData.postcode,
        },
      });

      await prisma.sourceSiteMatch.update({
        where: { id },
        data: {
          matchedSiteId: newSite.id,
          matchMethod: "NEW_SITE_CREATED",
          reviewStatus: "CONFIRMED",
          reviewedBy: actor,
          reviewedAt: new Date(),
        },
      });

      // Create alias
      await prisma.siteAlias.create({
        data: {
          siteId: newSite.id,
          aliasText: match.rawSiteText.toLowerCase().trim(),
          sourceType: match.sourceSystem as "WHATSAPP" | "OUTLOOK" | "ZOHO_BOOKS" | "EMAIL" | "PDF_UPLOAD" | "IMAGE_UPLOAD" | "MANUAL" | "API",
          confidenceDefault: 95,
        },
      });

    } else if (action === "reject" || action === "not_a_site") {
      await prisma.sourceSiteMatch.update({
        where: { id },
        data: {
          reviewStatus: "REJECTED",
          matchMethod: action === "not_a_site" ? "NOT_A_SITE" : "REJECTED",
          reviewedBy: actor,
          reviewedAt: new Date(),
        },
      });
    }

    await logAudit({
      objectType: "SourceSiteMatch",
      objectId: id,
      actionType: `SITE_RESOLUTION_${action.toUpperCase()}`,
      actor,
      previousValue: { reviewStatus: previousStatus, rawSiteText: match.rawSiteText },
      newValue: { action, siteId, reason },
      reason,
    });

    const updated = await prisma.sourceSiteMatch.findUnique({
      where: { id },
      include: { matchedSite: { select: { id: true, siteName: true } } },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Site resolution failed:", error);
    return Response.json({ error: "Resolution failed" }, { status: 500 });
  }
}

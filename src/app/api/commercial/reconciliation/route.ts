import { prisma } from "@/lib/prisma";
import { runReconciliation } from "@/lib/commercial/reconciliation-engine";

/**
 * GET /api/commercial/reconciliation?siteId=xxx
 * Returns cached reconciliation results for a site.
 *
 * POST /api/commercial/reconciliation
 * Triggers a full reconciliation run for a site and returns fresh results.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }

    const results = await prisma.reconciliationResult.findMany({
      where: { siteId },
      include: { canonicalProduct: true },
      orderBy: { canonicalProduct: { code: "asc" } },
    });

    return Response.json(results);
  } catch (error) {
    console.error("Failed to fetch reconciliation results:", error);
    return Response.json({ error: "Failed to fetch reconciliation results" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId } = body;

    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }

    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return Response.json({ error: "Site not found" }, { status: 404 });
    }

    const results = await runReconciliation(siteId);

    return Response.json({
      site: { id: site.id, name: site.siteName },
      calculatedAt: new Date().toISOString(),
      productCount: results.length,
      results,
    });
  } catch (error) {
    console.error("Failed to run reconciliation:", error);
    return Response.json({ error: "Failed to run reconciliation" }, { status: 500 });
  }
}

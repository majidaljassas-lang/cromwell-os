import { prisma } from "@/lib/prisma";
import { buildSupplyEvents } from "@/lib/commercial/supply-builder";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");
    if (!siteId) return Response.json({ error: "siteId required" }, { status: 400 });

    const events = await prisma.supplyEvent.findMany({
      where: { siteId },
      include: { canonicalProduct: true },
      orderBy: { timestamp: "desc" },
    });

    return Response.json({
      total: events.length,
      events: JSON.parse(JSON.stringify(events)),
    });
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { siteId, caseId } = await request.json();
    if (!siteId || !caseId) return Response.json({ error: "siteId and caseId required" }, { status: 400 });

    const result = await buildSupplyEvents(siteId, caseId);
    return Response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}

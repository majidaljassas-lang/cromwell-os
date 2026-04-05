import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const queueType = searchParams.get("queueType");
    const status = searchParams.get("status");
    const siteId = searchParams.get("siteId");

    const where: Record<string, unknown> = {};
    if (queueType) where.queueType = queueType;
    if (status) where.status = status;
    else where.status = { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] };
    if (siteId) where.siteId = siteId;

    const items = await prisma.reviewQueueItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // Group by queue type for summary
    const summary: Record<string, number> = {};
    const allOpen = await prisma.reviewQueueItem.findMany({
      where: { status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] } },
    });
    for (const item of allOpen) {
      summary[item.queueType] = (summary[item.queueType] || 0) + 1;
    }

    return Response.json({ items, summary });
  } catch (error) {
    console.error("Failed to list review queue:", error);
    return Response.json({ error: "Failed to list review queue" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status, resolvedValue, resolvedBy } = body;

    if (!id || !status) {
      return Response.json({ error: "id and status are required" }, { status: 400 });
    }

    const data: Record<string, unknown> = { status };
    if (resolvedValue !== undefined) data.resolvedValue = resolvedValue;
    if (resolvedBy !== undefined) data.resolvedBy = resolvedBy;
    if (status === "RESOLVED" || status === "DISMISSED") {
      data.resolvedAt = new Date();
    }

    const updated = await prisma.reviewQueueItem.update({
      where: { id },
      data,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update review queue item:", error);
    return Response.json({ error: "Failed to update review queue item" }, { status: 500 });
  }
}

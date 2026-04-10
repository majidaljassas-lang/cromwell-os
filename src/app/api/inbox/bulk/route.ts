import { prisma } from "@/lib/prisma";

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const { ids, itemTypes } = body as {
      ids?: unknown;
      itemTypes?: unknown;
    };

    if (!Array.isArray(ids) || !Array.isArray(itemTypes)) {
      return Response.json(
        { error: "ids and itemTypes must be arrays" },
        { status: 400 }
      );
    }
    if (ids.length === 0) {
      return Response.json({ success: true, dismissed: 0 });
    }
    if (ids.length !== itemTypes.length) {
      return Response.json(
        { error: "ids and itemTypes must have the same length" },
        { status: 400 }
      );
    }

    const ingestionIds: string[] = [];
    const workItemIds: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const t = itemTypes[i];
      if (typeof id !== "string") continue;
      if (t === "INGESTION") ingestionIds.push(id);
      else if (t === "WORK_ITEM") workItemIds.push(id);
    }

    let dismissed = 0;
    if (ingestionIds.length > 0) {
      const res = await prisma.ingestionEvent.updateMany({
        where: { id: { in: ingestionIds } },
        data: { status: "DISMISSED" },
      });
      dismissed += res.count;
    }
    if (workItemIds.length > 0) {
      const res = await prisma.inquiryWorkItem.updateMany({
        where: { id: { in: workItemIds } },
        data: { status: "CLOSED_NO_ACTION" },
      });
      dismissed += res.count;
    }

    return Response.json({ success: true, dismissed });
  } catch (error) {
    console.error("Failed to bulk dismiss inbox items:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to bulk dismiss" },
      { status: 500 }
    );
  }
}

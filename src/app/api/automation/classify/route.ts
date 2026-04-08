import { prisma } from "@/lib/prisma";
import { classifyMessage } from "@/lib/ingestion/classifier";

/**
 * POST /api/automation/classify
 * Reclassify all PARSED ingestion events that haven't been classified yet.
 */
export async function POST() {
  try {
    const events = await prisma.ingestionEvent.findMany({
      where: { status: "PARSED" },
      include: { parsedMessages: { select: { extractedText: true } } },
    });

    const counts: Record<string, number> = {};
    for (const event of events) {
      const text = event.parsedMessages?.[0]?.extractedText || "";
      const result = classifyMessage(text);
      const kind = event.eventKind === "OUTLOOK_SENT" ? "OUTLOOK_SENT" : result.classification;

      counts[kind] = (counts[kind] || 0) + 1;

      await prisma.ingestionEvent.update({
        where: { id: event.id },
        data: { eventKind: kind, status: "CLASSIFIED" },
      });
    }

    return Response.json({ classified: events.length, breakdown: counts });
  } catch (error) {
    console.error("Classification failed:", error);
    return Response.json({ error: "Classification failed" }, { status: 500 });
  }
}

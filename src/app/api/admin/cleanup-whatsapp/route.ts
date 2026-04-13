import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    // Find all WhatsApp ingestion events
    const events = await prisma.ingestionEvent.findMany({
      where: { source: { sourceType: "WHATSAPP" } },
      select: { id: true },
    });

    if (events.length === 0) {
      return Response.json({ deleted: 0, message: "No WhatsApp events found" });
    }

    const ids = events.map(e => e.id);

    // Get parsed message IDs
    const msgIds = (await prisma.parsedMessage.findMany({
      where: { ingestionEventId: { in: ids } },
      select: { id: true },
    })).map(m => m.id);

    // Delete in dependency order
    if (msgIds.length > 0) {
      await prisma.ingestionLink.deleteMany({ where: { parsedMessageId: { in: msgIds } } }).catch(() => {});
    }
    await prisma.draftInvoiceRecoveryItem.deleteMany({ where: { ingestionEventId: { in: ids } } }).catch(() => {});
    await prisma.parsedMessage.deleteMany({ where: { ingestionEventId: { in: ids } } });
    await prisma.ingestionEvent.deleteMany({ where: { id: { in: ids } } });

    return Response.json({ deleted: ids.length, message: `Purged ${ids.length} WhatsApp ingestion events` });
  } catch (error) {
    console.error("Cleanup failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

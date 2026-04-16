/**
 * DELETE /api/inbox/messages/:id — remove a single message from a thread
 *
 * Deletes the InboxThreadMessage + its underlying IngestionEvent + ParsedMessage.
 * If the thread becomes empty after deletion, the thread itself is removed.
 */

import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const msg = await prisma.inboxThreadMessage.findUnique({
    where: { id },
    select: { id: true, threadId: true, ingestionEventId: true },
  });
  if (!msg) return Response.json({ error: "message not found" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    // Delete parsed messages for this event
    const parsed = await tx.parsedMessage.findMany({
      where: { ingestionEventId: msg.ingestionEventId },
      select: { id: true },
    });
    const parsedIds = parsed.map((p) => p.id);
    if (parsedIds.length > 0) {
      await tx.extractedEntity.deleteMany({ where: { parsedMessageId: { in: parsedIds } } });
      await tx.ingestionLink.deleteMany({ where: { parsedMessageId: { in: parsedIds } } });
      await tx.parsedMessage.deleteMany({ where: { id: { in: parsedIds } } });
    }

    // Delete inbound events
    await tx.inboundEvent.deleteMany({ where: { ingestionEventId: msg.ingestionEventId } });

    // Delete intake documents (not tied to bills)
    await tx.intakeDocument.deleteMany({ where: { ingestionEventId: msg.ingestionEventId, supplierBillId: null } });

    // Delete the thread message
    await tx.inboxThreadMessage.delete({ where: { id } });

    // Delete the ingestion event
    await tx.ingestionEvent.delete({ where: { id: msg.ingestionEventId } }).catch(() => {});

    // If thread is now empty, delete it
    const remaining = await tx.inboxThreadMessage.count({ where: { threadId: msg.threadId } });
    if (remaining === 0) {
      await tx.inboxThread.delete({ where: { id: msg.threadId } });
    } else {
      // Update thread message count
      await tx.inboxThread.update({
        where: { id: msg.threadId },
        data: { messageCount: remaining },
      });
    }
  });

  return Response.json({ ok: true });
}

import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/ingestion/events/[id]/link
 * Manually link an ingestion event to a ticket or enquiry.
 * Also allows override of classification.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { ticketId, enquiryId, classification, dismiss } = body;

    // If dismissing, mark as dismissed
    if (dismiss) {
      await prisma.ingestionEvent.update({
        where: { id },
        data: { status: "DISMISSED" },
      });
      // Also dismiss any linked InboundEvent
      await prisma.inboundEvent.updateMany({
        where: { ingestionEventId: id },
        data: { linkStatus: "UNPROCESSED" },
      });
      return Response.json({ ok: true, dismissed: true });
    }

    // Update classification if provided
    if (classification) {
      await prisma.ingestionEvent.update({
        where: { id },
        data: { eventKind: classification },
      });
    }

    // Link to ticket
    if (ticketId) {
      await prisma.inboundEvent.updateMany({
        where: { ingestionEventId: id },
        data: {
          linkedTicketId: ticketId,
          linkStatus: "LINKED_HIGH",
          linkConfidence: 100,
          resolvedBy: "MANUAL",
          resolvedAt: new Date(),
        },
      });

      // Also create an Event on the ticket for audit trail
      const event = await prisma.ingestionEvent.findUnique({
        where: { id },
        include: { parsedMessages: { select: { extractedText: true } } },
      });
      if (event) {
        await prisma.event.create({
          data: {
            ticketId,
            eventType: "COMMUNICATION_LINKED",
            timestamp: event.receivedAt,
            sourceRef: event.externalMessageId || undefined,
            notes: event.parsedMessages?.[0]?.extractedText?.substring(0, 200) || "Linked from ingestion",
          },
        });
      }

      await prisma.ingestionEvent.update({
        where: { id },
        data: { status: "LINKED" },
      });
    }

    // Link to enquiry
    if (enquiryId) {
      await prisma.inboundEvent.updateMany({
        where: { ingestionEventId: id },
        data: {
          linkedEnquiryId: enquiryId,
          linkStatus: "LINKED_HIGH",
          linkConfidence: 100,
          resolvedBy: "MANUAL",
          resolvedAt: new Date(),
        },
      });
      await prisma.ingestionEvent.update({
        where: { id },
        data: { status: "LINKED" },
      });
    }

    return Response.json({ ok: true, linkedTo: ticketId || enquiryId });
  } catch (error) {
    console.error("Manual link failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to link" }, { status: 500 });
  }
}

/**
 * DELETE /api/ingestion/events/[id]/link
 * Dismiss/delete an ingestion event from the inbox.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.ingestionEvent.update({
      where: { id },
      data: { status: "DISMISSED" },
    });
    return Response.json({ ok: true, dismissed: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to dismiss" }, { status: 500 });
  }
}

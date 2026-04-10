import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, itemType, ticketId, payingCustomerId, title, ticketMode, siteId, siteCommercialLinkId } = body;

    if (!action || !itemType) {
      return Response.json(
        { error: "action and itemType are required" },
        { status: 400 }
      );
    }

    // ── DISMISS ──────────────────────────────────────────────────────────
    if (action === "dismiss") {
      if (itemType === "INGESTION") {
        await prisma.ingestionEvent.update({
          where: { id },
          data: { status: "DISMISSED" },
        });
      } else if (itemType === "WORK_ITEM") {
        await prisma.inquiryWorkItem.update({
          where: { id },
          data: { status: "CLOSED_NO_ACTION" },
        });
      }
      return Response.json({ success: true });
    }

    // ── CONVERT TO TICKET ────────────────────────────────────────────────
    if (action === "convert") {
      if (!payingCustomerId || !title || !ticketMode) {
        return Response.json(
          { error: "payingCustomerId, title, and ticketMode are required for conversion" },
          { status: 400 }
        );
      }

      // Verify paying customer is a billing entity
      const customer = await prisma.customer.findUnique({
        where: { id: payingCustomerId },
        select: { isBillingEntity: true, name: true },
      });
      if (customer && customer.isBillingEntity === false) {
        return Response.json(
          { error: `Customer "${customer.name}" is not a billing entity. Use the parent billing entity instead.` },
          { status: 422 }
        );
      }

      // For ingestion events, copy the source message text into the ticket description
      // so the RFQ extractor has material to work with
      let description: string | undefined;
      if (itemType === "INGESTION") {
        const parsedMessage = await prisma.parsedMessage.findFirst({
          where: { ingestionEventId: id },
          orderBy: { createdAt: "desc" },
          select: { extractedText: true },
        });
        if (parsedMessage?.extractedText) {
          description = parsedMessage.extractedText;
        } else {
          // Fallback: get raw payload from ingestion event
          const event = await prisma.ingestionEvent.findUnique({
            where: { id },
            select: { rawPayload: true },
          });
          if (event?.rawPayload) {
            const payload = event.rawPayload as any;
            description = payload?.message_text || payload?.body || payload?.text || payload?.subject || undefined;
          }
        }
      }

      const ticket = await prisma.ticket.create({
        data: {
          payingCustomerId,
          title,
          description,
          ticketMode,
          status: "CAPTURED",
          revenueState: "OPERATIONAL",
          siteId: siteId || undefined,
          siteCommercialLinkId: siteCommercialLinkId || undefined,
        },
      });

      if (itemType === "INGESTION") {
        const parsedMessage = await prisma.parsedMessage.findFirst({
          where: { ingestionEventId: id },
          orderBy: { createdAt: "desc" },
        });

        if (parsedMessage) {
          await prisma.ingestionLink.create({
            data: {
              parsedMessageId: parsedMessage.id,
              ticketId: ticket.id,
              linkStatus: "CONFIRMED",
            },
          });
        }

        await prisma.ingestionEvent.update({
          where: { id },
          data: { status: "ACTIONED" },
        });
      } else if (itemType === "WORK_ITEM") {
        await prisma.inquiryWorkItem.update({
          where: { id },
          data: {
            status: "CONVERTED",
            ticketId: ticket.id,
            customerId: payingCustomerId,
            siteId: siteId || undefined,
            siteCommercialLinkId: siteCommercialLinkId || undefined,
          },
        });
      }

      return Response.json({ success: true, ticketId: ticket.id });
    }

    // ── LINK TO TICKET ───────────────────────────────────────────────────
    if (action === "link") {
      if (!ticketId) {
        return Response.json(
          { error: "ticketId is required for linking" },
          { status: 400 }
        );
      }

      if (itemType === "INGESTION") {
        const parsedMessage = await prisma.parsedMessage.findFirst({
          where: { ingestionEventId: id },
          orderBy: { createdAt: "desc" },
        });

        if (parsedMessage) {
          await prisma.ingestionLink.create({
            data: {
              parsedMessageId: parsedMessage.id,
              ticketId,
              linkStatus: "CONFIRMED",
            },
          });
        }

        await prisma.ingestionEvent.update({
          where: { id },
          data: { status: "ACTIONED" },
        });
      } else if (itemType === "WORK_ITEM") {
        await prisma.inquiryWorkItem.update({
          where: { id },
          data: {
            status: "CONVERTED",
            ticketId,
          },
        });
      }

      return Response.json({ success: true, ticketId });
    }

    return Response.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to process inbox action:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to process action" },
      { status: 500 }
    );
  }
}

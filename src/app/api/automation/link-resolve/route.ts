import { prisma } from "@/lib/prisma";
import { resolveLink } from "@/lib/ingestion/link-resolver";

/**
 * POST /api/automation/link-resolve
 * Run link resolver on all unlinked InboundEvents.
 */
export async function POST() {
  try {
    const events = await prisma.inboundEvent.findMany({
      where: { linkStatus: "UNPROCESSED" },
      select: {
        id: true,
        eventType: true,
        sourceType: true,
        sender: true,
        senderPhone: true,
        senderEmail: true,
        receivedAt: true,
        rawText: true,
        subject: true,
        ingestionEventId: true,
      },
      take: 200,
    });

    let linked = 0;
    let review = 0;
    let newEnquiry = 0;
    let failed = 0;

    for (const event of events) {
      try {
        const result = await resolveLink({
          eventType: event.eventType,
          sourceType: event.sourceType,
          sender: event.sender,
          senderPhone: event.senderPhone,
          senderEmail: event.senderEmail,
          receivedAt: event.receivedAt,
          rawText: event.rawText,
          subject: event.subject,
          ingestionEventId: event.ingestionEventId,
        });

        if (result.linkStatus === "LINKED_HIGH" || result.linkStatus === "LINKED_MEDIUM") linked++;
        else if (result.linkStatus === "NEEDS_REVIEW") review++;
        else newEnquiry++;
      } catch {
        failed++;
      }
    }

    return Response.json({
      processed: events.length,
      linked,
      needsReview: review,
      newEnquiryCandidates: newEnquiry,
      failed,
    });
  } catch (error) {
    console.error("Link resolve failed:", error);
    return Response.json({ error: "Link resolve failed" }, { status: 500 });
  }
}

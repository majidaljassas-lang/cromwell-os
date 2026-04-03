import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

/**
 * Enquiry Disposition
 * POST: discard, spam, duplicate, archive — with reason
 *
 * Discarded enquiries are removed from active queue but retained for audit.
 * If enquiry has downstream objects (work items, tickets), block discard
 * unless unlinked first.
 */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, reason, actor } = body as {
      action: "DISCARDED" | "SPAM" | "DUPLICATE" | "ARCHIVED";
      reason?: string;
      actor?: string;
    };

    if (!action) {
      return Response.json({ error: "action required" }, { status: 400 });
    }

    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        workItems: { select: { id: true, status: true } },
        ingestionLinks: { select: { id: true, ticketId: true } },
      },
    });

    if (!enquiry) {
      return Response.json({ error: "Enquiry not found" }, { status: 404 });
    }

    // Block discard if downstream objects exist
    const activeWorkItems = enquiry.workItems.filter(
      (w) => w.status !== "CLOSED_LOST" && w.status !== "CLOSED_NO_ACTION"
    );
    const linkedTickets = enquiry.ingestionLinks.filter((l) => l.ticketId != null);

    if (action === "DISCARDED" && (activeWorkItems.length > 0 || linkedTickets.length > 0)) {
      return Response.json({
        error: "Cannot discard — enquiry has active downstream objects",
        activeWorkItems: activeWorkItems.length,
        linkedTickets: linkedTickets.length,
        suggestion: "Unlink downstream objects first or use ARCHIVED instead",
      }, { status: 409 });
    }

    const previousStatus = enquiry.status;

    const updated = await prisma.enquiry.update({
      where: { id },
      data: {
        status: action,
        discardReason: reason || action,
        discardedBy: actor || "UNKNOWN",
        discardedAt: new Date(),
      },
    });

    await logAudit({
      objectType: "Enquiry",
      objectId: id,
      actionType: `DISPOSITION_${action}`,
      actor,
      previousValue: { status: previousStatus },
      newValue: { status: action, reason },
      reason,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Enquiry disposition failed:", error);
    return Response.json({ error: "Disposition failed" }, { status: 500 });
  }
}

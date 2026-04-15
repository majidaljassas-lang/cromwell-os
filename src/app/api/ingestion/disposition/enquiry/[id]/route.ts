import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

/**
 * Enquiry Disposition — the ONLY mutation surface left on the legacy
 * Enquiry model after Phase 7. Restricted to terminal closures:
 *
 *   status = "CLOSED"         — standard closure
 *   status = "LEGACY_ORPHAN"  — Phase-7 orphan state
 *
 * Any other status payload returns 400. The block on active downstream
 * objects (open work items, linked tickets) is retained.
 */

const ALLOWED_STATUSES = new Set(["CLOSED", "LEGACY_ORPHAN"]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { status, reason, actor } = body as {
      status?: string;
      reason?: string;
      actor?: string;
    };

    if (!status || !ALLOWED_STATUSES.has(status)) {
      return Response.json(
        {
          error:
            "Enquiry disposition is restricted to CLOSED / LEGACY_ORPHAN transitions only. The legacy pipeline is deprecated; no other status writes are accepted.",
          deprecatedSince: "2026-04-15",
          allowed: Array.from(ALLOWED_STATUSES),
          received: status ?? "(none)",
        },
        { status: 400 }
      );
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

    // Block closure if active downstream objects exist (same rule as before)
    const activeWorkItems = enquiry.workItems.filter(
      (w) =>
        w.status !== "CLOSED_LOST" &&
        w.status !== "CLOSED_NO_ACTION" &&
        w.status !== "LEGACY_ORPHAN"
    );
    const linkedTickets = enquiry.ingestionLinks.filter((l) => l.ticketId != null);

    if (
      status === "CLOSED" &&
      (activeWorkItems.length > 0 || linkedTickets.length > 0)
    ) {
      return Response.json(
        {
          error: "Cannot close — enquiry has active downstream objects",
          activeWorkItems: activeWorkItems.length,
          linkedTickets: linkedTickets.length,
          suggestion:
            "Orphan the work items first (LEGACY_ORPHAN) or unlink tickets before closing.",
        },
        { status: 409 }
      );
    }

    const previousStatus = enquiry.status;

    const updated = await prisma.enquiry.update({
      where: { id },
      data: {
        status,
        discardReason: reason ?? status,
        discardedBy: actor ?? "UNKNOWN",
        discardedAt: new Date(),
      },
    });

    await logAudit({
      objectType: "Enquiry",
      objectId: id,
      actionType: `DISPOSITION_${status}`,
      actor,
      previousValue: { status: previousStatus },
      newValue: { status, reason },
      reason,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Enquiry disposition failed:", error);
    return Response.json({ error: "Disposition failed" }, { status: 500 });
  }
}

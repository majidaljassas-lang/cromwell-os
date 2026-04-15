import { prisma } from "@/lib/prisma";

const DEPRECATED = {
  error:
    "InquiryWorkItem mutation is deprecated. The modern flow operates on Ticket directly via /api/tickets/[id]. The inbox action route (/api/inbox/[id]/action) is the only remaining writer for legacy work-item state.",
  deprecatedSince: "2026-04-15",
  replacement: "/api/tickets/[id] or /api/inbox/[id]/action",
} as const;

/**
 * GET /api/work-items/[id]
 *
 * Read-only retained for the legacy queue UI. Write verbs deprecated
 * 2026-04-15 (Phase 7).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const workItem = await prisma.inquiryWorkItem.findUnique({
      where: { id },
      include: {
        enquiry: true,
        site: true,
        siteCommercialLink: true,
        customer: true,
        requestedByContact: true,
      },
    });
    if (!workItem) {
      return Response.json({ error: "Work item not found" }, { status: 404 });
    }
    return Response.json(workItem);
  } catch (error) {
    console.error("Failed to get work item:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get work item" },
      { status: 500 }
    );
  }
}

// DEPRECATED 2026-04-15 (Phase 7)
export async function PATCH(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function PUT(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function DELETE(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}

import { prisma } from "@/lib/prisma";

const DEPRECATED = {
  error:
    "Enquiry creation is deprecated. The modern flow is IngestionEvent → InboxThread → Ticket. Use /api/inbox and /api/tickets.",
  deprecatedSince: "2026-04-15",
  replacement: "/api/inbox, /api/tickets",
} as const;

/**
 * GET /api/enquiries
 *
 * Read-only list of legacy enquiries. The Enquiry pipeline is DEPRECATED
 * as of 2026-04-15 (Phase 7) — all writes return 410. This handler stays
 * functional for historical queries and the legacy enquiries table UI.
 */
export async function GET() {
  try {
    const enquiries = await prisma.enquiry.findMany({
      include: {
        sourceContact: true,
        suggestedSite: true,
        suggestedCustomer: true,
      },
      orderBy: { receivedAt: "desc" },
    });
    return Response.json(enquiries);
  } catch (error) {
    console.error("Failed to list enquiries:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list enquiries" },
      { status: 500 }
    );
  }
}

// DEPRECATED 2026-04-15 (Phase 7)
export async function POST(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function PATCH(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function PUT(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function DELETE(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}

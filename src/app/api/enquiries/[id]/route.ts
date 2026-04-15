import { prisma } from "@/lib/prisma";

const DEPRECATED = {
  error:
    "Enquiry update is deprecated. Use /api/ingestion/disposition/enquiry/[id] for CLOSED / LEGACY_ORPHAN transitions.",
  deprecatedSince: "2026-04-15",
  replacement: "/api/ingestion/disposition/enquiry/[id]",
} as const;

/**
 * GET /api/enquiries/[id]
 *
 * Read-only fetch for legacy enquiries. Write verbs deprecated 2026-04-15.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        sourceContact: true,
        suggestedSite: true,
        suggestedCustomer: true,
        workItems: true,
      },
    });
    if (!enquiry) {
      return Response.json({ error: "Enquiry not found" }, { status: 404 });
    }
    return Response.json(enquiry);
  } catch (error) {
    console.error("Failed to get enquiry:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get enquiry" },
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

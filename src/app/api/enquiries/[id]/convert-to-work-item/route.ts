/**
 * POST /api/enquiries/[id]/convert-to-work-item
 *
 * DEPRECATED 2026-04-15 (Phase 7). The Enquiry → InquiryWorkItem → Ticket
 * flow is retired. The modern flow is IngestionEvent → InboxThread →
 * Ticket. Use /api/inbox/[id]/action to convert inbox threads to tickets.
 */
const DEPRECATED = {
  error:
    "Enquiry→WorkItem→Ticket conversion is deprecated. Use /api/inbox/[id]/action to convert inbox threads to tickets.",
  deprecatedSince: "2026-04-15",
  replacement: "/api/inbox/[id]/action",
} as const;

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

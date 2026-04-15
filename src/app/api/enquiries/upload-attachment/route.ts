/**
 * POST /api/enquiries/upload-attachment
 *
 * DEPRECATED 2026-04-15 (Phase 7). Enquiry attachments live on the legacy
 * pipeline. Attach files via the inbox / ticket flows instead.
 */
const DEPRECATED = {
  error:
    "Enquiry attachment upload is deprecated. Use the inbox thread or ticket upload endpoints instead.",
  deprecatedSince: "2026-04-15",
  replacement: "/api/inbox/[id]/action (attachments) or /api/tickets/[id]",
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

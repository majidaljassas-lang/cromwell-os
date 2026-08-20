/**
 * POST /api/finance/vat-return/[id]/submit
 *   Body: { hmrcRef?: string }
 * Marks the return as SUBMITTED and posts the settlement JE.
 */
import { submitReturn } from "@/lib/finance/vat-return";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as { hmrcRef?: string };
    const result = await submitReturn(id, body.hmrcRef);
    return Response.json({ ok: true, return: result });
  } catch (e) {
    console.error("/api/finance/vat-return/[id]/submit POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}

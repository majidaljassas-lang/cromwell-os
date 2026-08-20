import { prisma } from "@/lib/prisma";

/**
 * Per-pair approve / reject endpoint.
 *   APPROVE — preserves the match, rewrites matchReason to "MANUAL · approved [orig]"
 *             so it disappears from the review queue.
 *   REJECT  — clears matchedInvoiceLineId, clearStatus, matchConfidence so it
 *             flows back into the UNLINKED bucket and can be re-matched manually
 *             via the SPLIT modal or left unlinked.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ billLineId: string }> }
) {
  const { billLineId } = await params;
  const body = await request.json();
  const action = body.action as "APPROVE" | "REJECT";
  const note = typeof body.note === "string" ? body.note : null;

  if (action !== "APPROVE" && action !== "REJECT") {
    return Response.json({ error: "action must be APPROVE or REJECT" }, { status: 400 });
  }

  const bl = await prisma.zohoImportedBillLine.findUnique({
    where: { id: billLineId },
    select: { id: true, matchReason: true, matchedInvoiceLineId: true, matchConfidence: true },
  });
  if (!bl) return Response.json({ error: "bill line not found" }, { status: 404 });
  if (!bl.matchedInvoiceLineId) return Response.json({ error: "bill line has no match" }, { status: 400 });

  if (action === "APPROVE") {
    const orig = bl.matchReason || "";
    const newReason = orig.startsWith("MANUAL ·") ? orig : `MANUAL · approved ${orig}${note ? ` · ${note}` : ""}`;
    await prisma.zohoImportedBillLine.update({
      where: { id: billLineId },
      data: {
        matchReason: newReason.slice(0, 500),
        matchConfidence: 100,
        clearStatus: "CLEARED",
        matchedAt: new Date(),
      },
    });
    return Response.json({ ok: true, action: "APPROVED" });
  }

  // REJECT
  await prisma.zohoImportedBillLine.update({
    where: { id: billLineId },
    data: {
      matchedInvoiceLineId: null,
      matchConfidence: null,
      matchReason: note ? `REJECTED · ${note}` : "REJECTED",
      clearStatus: null,
      matchedAt: new Date(),
    },
  });
  return Response.json({ ok: true, action: "REJECTED" });
}

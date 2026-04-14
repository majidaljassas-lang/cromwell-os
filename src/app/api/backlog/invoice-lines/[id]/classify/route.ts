import { prisma } from "@/lib/prisma";

const ALLOWED = new Set([
  "OFF_CHAT_ORDER",
  "CONFIRMED_OFF_CHAT",
  "NOT_OUR_ORDER",
  "MANUAL_LINKED",
  "REORDER",
]);

/**
 * POST /api/backlog/invoice-lines/[id]/classify
 * Body: { classification: string | null, note?: string }
 *
 * Sets BacklogInvoiceLine.classification. Pass null to clear.
 * Used by the Off-Chat triage screen.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const classification: string | null = body?.classification ?? null;
    const note: string | undefined = body?.note;

    if (classification != null && !ALLOWED.has(classification)) {
      return Response.json(
        { error: `classification must be one of ${[...ALLOWED].join(", ")} or null` },
        { status: 400 },
      );
    }

    const existing = await prisma.backlogInvoiceLine.findUnique({ where: { id } });
    if (!existing) return Response.json({ error: "Invoice line not found" }, { status: 404 });

    const updated = await prisma.backlogInvoiceLine.update({
      where: { id },
      data: {
        classification,
        classificationNote: note ?? null,
        classifiedAt: classification ? new Date() : null,
      },
    });

    return Response.json({ ok: true, invoiceLine: updated });
  } catch (err) {
    console.error("classify-invoice-line failed:", err);
    return Response.json({ error: "Failed to classify invoice line" }, { status: 500 });
  }
}

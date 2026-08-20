import { prisma } from "@/lib/prisma";
import { createSubstitutionBatch, type SwapInput } from "@/lib/calloffs/substitution/create";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: poId } = await params;
  const batches = await prisma.callOffSubstitution.findMany({
    where: { customerPOId: poId },
    orderBy: { createdAt: "desc" },
    include: { lines: { orderBy: { displayOrder: "asc" } } },
  });
  return Response.json(batches);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: poId } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });

  const swaps: SwapInput[] = Array.isArray(body.swaps)
    ? body.swaps.flatMap((s) => {
        if (!s || typeof s !== "object") return [];
        const ss = s as Record<string, unknown>;
        if (typeof ss.oldTicketLineId !== "string") return [];
        if (typeof ss.newDescription !== "string" || !ss.newDescription.trim()) return [];
        return [
          {
            oldTicketLineId: ss.oldTicketLineId,
            newDescription: ss.newDescription,
            newCode: typeof ss.newCode === "string" ? ss.newCode : null,
            newCanonicalProductId:
              typeof ss.newCanonicalProductId === "string" ? ss.newCanonicalProductId : null,
            qtyToSwap: Number.isFinite(Number(ss.qtyToSwap)) ? Number(ss.qtyToSwap) : undefined,
            note: typeof ss.note === "string" ? ss.note : null,
          },
        ];
      })
    : [];

  if (swaps.length === 0) {
    return Response.json({ error: "swaps is required and must be non-empty" }, { status: 400 });
  }

  const initialState =
    body.initialState === "PENDING_CUSTOMER_CONFIRMATION"
      ? "PENDING_CUSTOMER_CONFIRMATION"
      : "DRAFT";

  try {
    const result = await createSubstitutionBatch({
      customerPOId: poId,
      callOffId: typeof body.callOffId === "string" ? body.callOffId : null,
      title,
      notes: typeof body.notes === "string" ? body.notes : null,
      swaps,
      initialState,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create substitution" },
      { status: 422 },
    );
  }
}

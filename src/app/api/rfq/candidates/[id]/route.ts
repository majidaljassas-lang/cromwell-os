import { prisma } from "@/lib/prisma";

/** PATCH: update candidate — edit, discard, change group label */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const f of ["extractedQty", "extractedUnit", "extractedProduct", "extractedSize", "extractedSpec", "extractedUnitCost", "suggestedLineType", "status", "groupLabel", "mergedIntoId"]) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }
    const updated = await prisma.extractedLineCandidate.update({ where: { id }, data: allowed });
    return Response.json(updated);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update candidate" }, { status: 500 });
  }
}

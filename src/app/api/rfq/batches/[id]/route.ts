import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const batch = await prisma.extractionBatch.findUnique({
      where: { id },
      include: { candidates: { orderBy: { createdAt: "asc" } } },
    });
    if (!batch) return Response.json({ error: "Batch not found" }, { status: 404 });
    return Response.json(batch);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch batch" }, { status: 500 });
  }
}

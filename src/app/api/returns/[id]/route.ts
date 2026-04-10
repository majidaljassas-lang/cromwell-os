import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.returnLine.deleteMany({ where: { returnId: id } });
    await prisma.return.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete" }, { status: 500 });
  }
}

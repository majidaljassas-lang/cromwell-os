import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const f of ["label", "sourceType"]) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }
    const s = await prisma.backlogSource.update({ where: { id }, data: allowed });
    return Response.json(s);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.backlogMessage.deleteMany({ where: { sourceId: id } });
    await prisma.backlogSource.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: "Failed to delete source" }, { status: 500 });
  }
}

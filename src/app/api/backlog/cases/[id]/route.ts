import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const c = await prisma.backlogCase.findUnique({
      where: { id },
      include: {
        sourceGroups: {
          include: {
            sources: {
              include: { _count: { select: { messages: true } } },
            },
          },
        },
      },
    });
    if (!c) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(c);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const f of ["name", "description", "siteRef", "status", "dateFrom", "dateTo"]) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }
    const c = await prisma.backlogCase.update({ where: { id }, data: allowed });
    return Response.json(c);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // Delete all messages, sources, groups, then case
    const groups = await prisma.backlogSourceGroup.findMany({ where: { caseId: id }, include: { sources: { select: { id: true } } } });
    const sourceIds = groups.flatMap((g) => g.sources.map((s) => s.id));
    if (sourceIds.length > 0) {
      await prisma.backlogMessage.deleteMany({ where: { sourceId: { in: sourceIds } } });
      await prisma.backlogSource.deleteMany({ where: { id: { in: sourceIds } } });
    }
    await prisma.backlogSourceGroup.deleteMany({ where: { caseId: id } });
    await prisma.backlogCase.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: "Failed to delete case" }, { status: 500 });
  }
}

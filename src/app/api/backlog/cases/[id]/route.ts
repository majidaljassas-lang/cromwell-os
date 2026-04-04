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
    const c = await prisma.backlogCase.update({ where: { id }, data: body });
    return Response.json(c);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const cases = await prisma.backlogCase.findMany({
      include: {
        sourceGroups: {
          include: {
            sources: { select: { id: true, messageCount: true, dateFrom: true, dateTo: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(cases);
  } catch (error) {
    return Response.json({ error: "Failed to fetch cases" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, siteRef, customerId, siteId, dateFrom, dateTo } = body;
    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    const c = await prisma.backlogCase.create({
      data: {
        name,
        description,
        siteRef,
        customerId: customerId || undefined,
        siteId: siteId || undefined,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo) : undefined,
      },
    });
    return Response.json(c, { status: 201 });
  } catch (error) {
    return Response.json({ error: "Failed to create case" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const compSheets = await prisma.compSheet.findMany({
      where: { ticketId: id },
      include: {
        lines: {
          include: { ticketLine: true },
        },
      },
      orderBy: { versionNo: "desc" },
    });

    return Response.json(compSheets);
  } catch (error) {
    console.error("Failed to fetch comp sheets:", error);
    return Response.json({ error: "Failed to fetch comp sheets" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, status, notes } = body;

    if (!name) {
      return Response.json({ error: "name is required" }, { status: 400 });
    }

    // Find the latest version number
    const latest = await prisma.compSheet.findFirst({
      where: { ticketId: id },
      orderBy: { versionNo: "desc" },
      select: { versionNo: true },
    });

    const compSheet = await prisma.compSheet.create({
      data: {
        ticketId: id,
        versionNo: (latest?.versionNo ?? 0) + 1,
        name,
        status: status ?? "DRAFT",
        notes,
      },
      include: {
        lines: {
          include: { ticketLine: true },
        },
      },
    });

    return Response.json(compSheet, { status: 201 });
  } catch (error) {
    console.error("Failed to create comp sheet:", error);
    return Response.json({ error: "Failed to create comp sheet" }, { status: 500 });
  }
}

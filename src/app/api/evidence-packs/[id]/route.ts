import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const pack = await prisma.evidencePack.findUnique({
      where: { id },
      include: {
        ticket: true,
        recoveryCase: true,
        items: {
          include: {
            evidenceFragment: true,
            event: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (!pack) {
      return Response.json(
        { error: "Evidence pack not found" },
        { status: 404 }
      );
    }

    return Response.json(pack);
  } catch (error) {
    console.error("Failed to get evidence pack:", error);
    return Response.json(
      { error: "Failed to get evidence pack" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { status, packType } = body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (packType !== undefined) data.packType = packType;

    const pack = await prisma.evidencePack.update({
      where: { id },
      data,
      include: {
        ticket: true,
        recoveryCase: true,
        items: {
          include: {
            evidenceFragment: true,
            event: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return Response.json(pack);
  } catch (error) {
    console.error("Failed to update evidence pack:", error);
    return Response.json(
      { error: "Failed to update evidence pack" },
      { status: 500 }
    );
  }
}

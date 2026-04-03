import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const pack = await prisma.evidencePack.update({
      where: { id },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
      },
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
    console.error("Failed to finalize evidence pack:", error);
    return Response.json(
      { error: "Failed to finalize evidence pack" },
      { status: 500 }
    );
  }
}

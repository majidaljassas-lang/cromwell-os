import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const dealSheet = await prisma.dealSheet.findFirst({
      where: { ticketId: id },
      orderBy: { versionNo: "desc" },
      include: {
        lineSnapshots: {
          include: { ticketLine: true },
        },
      },
    });

    return Response.json(dealSheet ?? null);
  } catch (error) {
    console.error("Failed to fetch deal sheet:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch deal sheet" }, { status: 500 });
  }
}

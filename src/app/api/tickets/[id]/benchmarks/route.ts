import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const benchmarks = await prisma.benchmark.findMany({
      where: {
        ticketLine: { ticketId: id },
      },
      include: { ticketLine: true },
      orderBy: { ticketLineId: "asc" },
    });

    return Response.json(benchmarks);
  } catch (error) {
    console.error("Failed to fetch benchmarks:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch benchmarks" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params;
    const body = await request.json();
    const { ticketLineId, benchmarkSource, sourceRef, unitPrice, qty, totalPrice, notes } = body;

    if (!ticketLineId || !benchmarkSource) {
      return Response.json(
        { error: "ticketLineId and benchmarkSource are required" },
        { status: 400 }
      );
    }

    const benchmark = await prisma.benchmark.create({
      data: {
        ticketLineId,
        benchmarkSource,
        sourceRef,
        unitPrice,
        qty,
        totalPrice,
        notes,
      },
      include: { ticketLine: true },
    });

    return Response.json(benchmark, { status: 201 });
  } catch (error) {
    console.error("Failed to create benchmark:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create benchmark" }, { status: 500 });
  }
}

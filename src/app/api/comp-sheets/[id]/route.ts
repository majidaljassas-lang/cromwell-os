import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const compSheet = await prisma.compSheet.findUnique({
      where: { id },
      include: {
        lines: {
          include: { ticketLine: true },
        },
      },
    });

    if (!compSheet) {
      return Response.json({ error: "Comp sheet not found" }, { status: 404 });
    }

    return Response.json(compSheet);
  } catch (error) {
    console.error("Failed to fetch comp sheet:", error);
    return Response.json({ error: "Failed to fetch comp sheet" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const compSheet = await prisma.compSheet.update({
      where: { id },
      data: body,
    });

    return Response.json(compSheet);
  } catch (error) {
    console.error("Failed to update comp sheet:", error);
    return Response.json({ error: "Failed to update comp sheet" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { ticketLineId, benchmarkTotal, ourCostTotal, ourSaleTotal, savingTotal, marginTotal, notes } = body;

    if (!ticketLineId) {
      return Response.json({ error: "ticketLineId is required" }, { status: 400 });
    }

    const line = await prisma.compSheetLine.create({
      data: {
        compSheetId: id,
        ticketLineId,
        benchmarkTotal,
        ourCostTotal,
        ourSaleTotal,
        savingTotal,
        marginTotal,
        notes,
      },
      include: { ticketLine: true },
    });

    return Response.json(line, { status: 201 });
  } catch (error) {
    console.error("Failed to add comp sheet line:", error);
    return Response.json({ error: "Failed to add comp sheet line" }, { status: 500 });
  }
}

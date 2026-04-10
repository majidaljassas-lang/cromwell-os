import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const entries = await prisma.materialsDrawdownEntry.findMany({
      where: { customerPOId: id },
      include: {
        ticket: true,
        ticketLine: true,
      },
      orderBy: { drawdownDate: "desc" },
    });

    return Response.json(entries);
  } catch (error) {
    console.error("Failed to list materials drawdowns:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list materials drawdowns" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      ticketId,
      ticketLineId,
      drawdownDate,
      description,
      qty,
      unitSell,
      sellValue: rawSellValue,
      unitCostExpected,
      costValueActual,
      status = "LOGGED",
    } = body;

    if (!ticketId || !drawdownDate || !description) {
      return Response.json(
        { error: "Missing required fields: ticketId, drawdownDate, description" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Fetch parent PO for overhead
      const po = await tx.customerPO.findUniqueOrThrow({
        where: { id },
      });

      // Auto-calculate sellValue if not provided
      let sellValue = rawSellValue != null ? Number(rawSellValue) : undefined;
      if (sellValue === undefined && qty != null && unitSell != null) {
        sellValue = Number(qty) * Number(unitSell);
      }
      const finalSellValue = sellValue ?? 0;

      const overheadPct = Number(po.overheadPct) || 10;
      const overheadValue = finalSellValue * overheadPct / 100;
      const grossProfitValue =
        finalSellValue - (Number(costValueActual) || 0) - overheadValue;

      const entry = await tx.materialsDrawdownEntry.create({
        data: {
          customerPOId: id,
          ticketId,
          ticketLineId,
          drawdownDate: new Date(drawdownDate),
          description,
          qty,
          unitSell,
          sellValue: finalSellValue,
          unitCostExpected,
          costValueActual,
          overheadPct,
          overheadValue,
          grossProfitValue,
          status,
        },
        include: {
          ticket: true,
          ticketLine: true,
        },
      });

      // Update PO consumed and remaining
      const poLimitValue = Number(po.poLimitValue) || 0;
      const currentConsumed = Number(po.poConsumedValue) || 0;
      const newConsumed = currentConsumed + finalSellValue;

      await tx.customerPO.update({
        where: { id },
        data: {
          poConsumedValue: newConsumed,
          poRemainingValue: poLimitValue - newConsumed,
        },
      });

      return entry;
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create materials drawdown:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create materials drawdown" },
      { status: 500 }
    );
  }
}

import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const entries = await prisma.labourDrawdownEntry.findMany({
      where: { customerPOId: id },
      include: {
        ticket: true,
        site: true,
        plumberContact: true,
      },
      orderBy: { workDate: "desc" },
    });

    return Response.json(entries);
  } catch (error) {
    console.error("Failed to list labour drawdowns:", error);
    return Response.json(
      { error: "Failed to list labour drawdowns" },
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
      siteId,
      weekEndingDate,
      workDate,
      plumberContactId,
      dayType,
      plumberCount,
      daysWorked,
      status = "LOGGED",
    } = body;

    if (!ticketId || !siteId || !workDate || !dayType || !plumberCount || daysWorked === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: ticketId, siteId, workDate, dayType, plumberCount, daysWorked",
        },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Fetch parent PO for rates
      const po = await tx.customerPO.findUniqueOrThrow({
        where: { id },
      });

      const isWeekend = dayType === "WEEKEND";
      const weekdaySell = Number(po.weekdaySellRate) || 450;
      const weekendSell = Number(po.weekendSellRate) || weekdaySell * 1.5;
      const weekdayCost = Number(po.weekdayCostRate) || 250;
      const weekendCost = Number(po.weekendCostRate) || weekdayCost * 1.5;

      const billableDayRate = isWeekend ? weekendSell : weekdaySell;
      const billableValue = billableDayRate * Number(daysWorked) * Number(plumberCount);
      const internalDayCost = isWeekend ? weekendCost : weekdayCost;
      const internalCostValue = internalDayCost * Number(daysWorked) * Number(plumberCount);
      const overheadPct = Number(po.overheadPct) || 10;
      const overheadValue = billableValue * overheadPct / 100;
      const grossProfitValue = billableValue - internalCostValue - overheadValue;

      const entry = await tx.labourDrawdownEntry.create({
        data: {
          customerPOId: id,
          ticketId,
          siteId,
          weekEndingDate: weekEndingDate ? new Date(weekEndingDate) : undefined,
          workDate: new Date(workDate),
          plumberContactId,
          dayType: dayType as "WEEKDAY" | "WEEKEND" | "CUSTOM",
          plumberCount,
          daysWorked,
          billableDayRate,
          billableValue,
          internalDayCost,
          internalCostValue,
          overheadPct,
          overheadValue,
          grossProfitValue,
          status,
        },
        include: {
          ticket: true,
          site: true,
          plumberContact: true,
        },
      });

      // Recalculate PO consumed and remaining
      const poLimitValue = Number(po.poLimitValue) || 0;
      const currentConsumed = Number(po.poConsumedValue) || 0;
      const newConsumed = currentConsumed + billableValue;

      // Sum all labour drawdown gross profits for profitToDate
      const allDrawdowns = await tx.labourDrawdownEntry.findMany({
        where: { customerPOId: id },
        select: { grossProfitValue: true },
      });
      const profitToDate = allDrawdowns.reduce(
        (sum, d) => sum + (Number(d.grossProfitValue) || 0),
        0
      );

      await tx.customerPO.update({
        where: { id },
        data: {
          poConsumedValue: newConsumed,
          poRemainingValue: poLimitValue - newConsumed,
          profitToDate,
        },
      });

      return entry;
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create labour drawdown:", error);
    return Response.json(
      { error: "Failed to create labour drawdown" },
      { status: 500 }
    );
  }
}

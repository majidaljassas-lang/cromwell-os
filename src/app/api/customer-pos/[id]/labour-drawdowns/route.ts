import { prisma } from "@/lib/prisma";
import { NextRequest } from "next/server";

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
      invoiceNo,
      invoiceDate,
      overrideBillable,
      deliveryAgainstAdvance,
      status = "LOGGED",
    } = body;

    if (!siteId || !workDate || !dayType || !plumberCount || daysWorked === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: siteId, workDate, dayType, plumberCount, daysWorked",
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
      const isAdvanceBilling = !!overrideBillable;
      const isDeliveryAgainstAdvance = !!deliveryAgainstAdvance;
      const internalDayCost = isWeekend ? weekendCost : weekdayCost;

      // Delivery against advance: real work done, but billing was already covered
      // Billable = 0 (don't double-count), cost = real, status = DELIVERED_AGAINST_ADVANCE
      const billableValue = isAdvanceBilling
        ? Number(overrideBillable)
        : isDeliveryAgainstAdvance
          ? 0
          : billableDayRate * Number(daysWorked) * Number(plumberCount);
      const internalCostValue = isAdvanceBilling
        ? 0
        : internalDayCost * Number(daysWorked) * Number(plumberCount);
      const overheadPct = Number(po.overheadPct) || 10;
      const overheadValue = (isAdvanceBilling || isDeliveryAgainstAdvance) ? 0 : billableValue * overheadPct / 100;
      const grossProfitValue = billableValue - internalCostValue - overheadValue;

      const entry = await tx.labourDrawdownEntry.create({
        data: {
          customerPOId: id,
          ticketId: ticketId || undefined,
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
          invoiceNo: invoiceNo || null,
          invoiceDate: invoiceDate ? new Date(invoiceDate) : null,
          status: isDeliveryAgainstAdvance ? "DELIVERED_AGAINST_ADVANCE" : isAdvanceBilling ? "ADVANCE_BILLED" : invoiceNo ? "INVOICED" : status,
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

      // Auto-progress PO status based on consumption
      let newStatus = po.status;
      if (newConsumed > 0 && po.status === "RECEIVED") {
        newStatus = "ACTIVE";
      }
      if (poLimitValue > 0 && newConsumed >= poLimitValue) {
        newStatus = "EXHAUSTED";
      }

      await tx.customerPO.update({
        where: { id },
        data: {
          poConsumedValue: newConsumed,
          poRemainingValue: poLimitValue - newConsumed,
          profitToDate,
          status: newStatus,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get("entryId");
    if (!entryId) {
      return Response.json({ error: "entryId required" }, { status: 400 });
    }

    const entry = await prisma.labourDrawdownEntry.findUnique({
      where: { id: entryId },
      select: { billableValue: true, grossProfitValue: true, customerPOId: true },
    });
    if (!entry || entry.customerPOId !== poId) {
      return Response.json({ error: "Entry not found" }, { status: 404 });
    }

    await prisma.labourDrawdownEntry.delete({ where: { id: entryId } });

    // Recalculate PO consumed/remaining
    const po = await prisma.customerPO.findUnique({ where: { id: poId } });
    if (po) {
      const allEntries = await prisma.labourDrawdownEntry.findMany({
        where: { customerPOId: poId },
        select: { billableValue: true, grossProfitValue: true },
      });
      const consumed = allEntries.reduce((s, e) => s + Number(e.billableValue), 0);
      const profit = allEntries.reduce((s, e) => s + (Number(e.grossProfitValue) || 0), 0);
      const limit = Number(po.poLimitValue) || 0;
      // Recalculate status
      let newStatus = po.status;
      if (consumed <= 0 && allEntries.length === 0) newStatus = "RECEIVED";
      else if (limit > 0 && consumed >= limit) newStatus = "EXHAUSTED";
      else if (consumed > 0) newStatus = "ACTIVE";

      await prisma.customerPO.update({
        where: { id: poId },
        data: { poConsumedValue: consumed, poRemainingValue: limit - consumed, profitToDate: profit, status: newStatus },
      });
    }

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete labour entry:", error);
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}

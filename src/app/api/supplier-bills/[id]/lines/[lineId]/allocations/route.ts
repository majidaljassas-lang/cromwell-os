import { prisma } from "@/lib/prisma";
import { BillAllocationType } from "@/generated/prisma";

const VALID_TYPES = ["TICKET_LINE", "STOCK", "RETURNS_CANDIDATE", "OVERHEAD", "UNRESOLVED"] as const;

interface AllocationInput {
  type: typeof VALID_TYPES[number];
  ticketLineId?: string | null;
  ticketId?: string | null;
  siteId?: string | null;
  customerId?: string | null;
  qty: number;
  cost?: number;
  confidence?: number;
  reason?: string;
}

/**
 * Replace the unposted allocations for a bill line with a user-supplied set.
 *
 * Posted allocations (ones already linked to CostAllocation / Return /
 * StockExcessRecord / AbsorbedCostAllocation) are left untouched — the
 * post-runner owns those.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; lineId: string }> }
) {
  const { id, lineId } = await params;
  const body = await request.json();
  const allocations: AllocationInput[] = Array.isArray(body.allocations) ? body.allocations : [];

  if (allocations.length === 0) {
    return Response.json({ error: "allocations array required" }, { status: 400 });
  }

  for (const a of allocations) {
    if (!VALID_TYPES.includes(a.type)) {
      return Response.json({ error: `invalid allocation type: ${a.type}` }, { status: 400 });
    }
    if (!Number.isFinite(a.qty) || a.qty <= 0) {
      return Response.json({ error: "every allocation needs a positive qty" }, { status: 400 });
    }
    if (a.type === "TICKET_LINE" && !a.ticketLineId && !a.ticketId) {
      return Response.json({ error: "TICKET_LINE allocation needs ticketLineId or ticketId" }, { status: 400 });
    }
  }

  const line = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    include: { billLineAllocations: true },
  });
  if (!line || line.supplierBillId !== id) {
    return Response.json({ error: "Bill line not found on this bill" }, { status: 404 });
  }

  const billedQty = Number(line.qty);
  const unitCost = Number(line.unitCost);
  const totalQty = allocations.reduce((s, a) => s + Number(a.qty), 0);
  if (Math.abs(totalQty - billedQty) > 0.0001) {
    return Response.json(
      { error: `allocation qty sum (${totalQty}) must equal line qty (${billedQty})` },
      { status: 400 }
    );
  }

  const postedAllocs = line.billLineAllocations.filter(
    (a) => a.costAllocationId || a.returnId || a.stockExcessRecordId || a.absorbedAllocationId
  );
  const postedQty = postedAllocs.reduce((s, a) => s + Number(a.qtyAllocated), 0);
  if (postedQty > 0) {
    return Response.json(
      {
        error:
          `cannot edit allocations: ${postedQty} units already posted downstream. ` +
          `Reverse the posted records first.`,
      },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.billLineAllocation.deleteMany({
      where: {
        supplierBillLineId: lineId,
        costAllocationId: null,
        returnId: null,
        stockExcessRecordId: null,
        absorbedAllocationId: null,
      },
    });

    for (const a of allocations) {
      const cost = Number.isFinite(a.cost) && a.cost! > 0
        ? Math.round(a.cost! * 100) / 100
        : Math.round(a.qty * unitCost * 100) / 100;

      await tx.billLineAllocation.create({
        data: {
          supplierBillLineId: lineId,
          allocationType:     a.type as BillAllocationType,
          ticketLineId:       a.ticketLineId ?? undefined,
          ticketId:           a.ticketId ?? undefined,
          siteId:             a.siteId ?? undefined,
          customerId:         a.customerId ?? undefined,
          qtyAllocated:       a.qty,
          costAllocated:      cost,
          confidence:         a.confidence ?? 100,
          reason:             a.reason ?? `Manual: ${a.type}`,
          createdBy:          "user",
        },
      });
    }

    const status =
      allocations.length === 1 && allocations[0].type === "TICKET_LINE"
        ? "MATCHED"
        : "PARTIAL";

    await tx.supplierBillLine.update({
      where: { id: lineId },
      data: { allocationStatus: status },
    });
  });

  const bill = await prisma.supplierBill.findUnique({
    where: { id },
    include: {
      supplier: true,
      lines: {
        include: { site: true, customer: true, ticket: true, costAllocations: true },
      },
    },
  });

  return Response.json({ bill });
}

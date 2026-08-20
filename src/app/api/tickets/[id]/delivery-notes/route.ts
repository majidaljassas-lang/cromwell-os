import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const notes = await prisma.deliveryNote.findMany({
      where: { ticketId: id },
      include: { lines: true },
      orderBy: { deliveryNo: "asc" },
    });
    return Response.json(notes);
  } catch (error) {
    console.error("Failed to list delivery notes:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list delivery notes" },
      { status: 500 }
    );
  }
}

type IncomingLine = {
  ticketLineId: string;
  qtyDelivered: number;
  qtyBackOrder?: number;
  status: "DELIVERED" | "PARTIAL" | "BACK_ORDER";
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ticketId } = await params;
    const body = await request.json();
    const deliveryDate = body.deliveryDate ? new Date(body.deliveryDate) : new Date();
    const signedBy: string | undefined = body.signedBy;
    const notes: string | undefined = body.notes;
    const callOffId: string | null =
      typeof body.callOffId === "string" && body.callOffId.length > 0 ? body.callOffId : null;
    const lines: IncomingLine[] = Array.isArray(body.lines) ? body.lines : [];

    if (lines.length === 0) {
      return Response.json({ error: "No lines on delivery note" }, { status: 400 });
    }

    // If scoped to a call-off, validate it belongs to this ticket and that every
    // input ticketLineId is on a CallOffLine of that call-off.
    if (callOffId) {
      const callOff = await prisma.callOff.findUnique({
        where: { id: callOffId },
        select: { id: true, ticketId: true, lines: { select: { ticketLineId: true } } },
      });
      if (!callOff) {
        return Response.json({ error: "CallOff not found" }, { status: 404 });
      }
      if (callOff.ticketId !== ticketId) {
        return Response.json(
          { error: "CallOff does not belong to this ticket" },
          { status: 422 }
        );
      }
      const allowed = new Set(callOff.lines.map((l) => l.ticketLineId));
      const offCallOff = lines.filter((l) => !allowed.has(l.ticketLineId)).map((l) => l.ticketLineId);
      if (offCallOff.length > 0) {
        return Response.json(
          {
            error: "Some ticketLineIds are not on this call-off",
            offCallOff,
          },
          { status: 422 }
        );
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.deliveryNote.findFirst({
        where: { ticketId },
        orderBy: { deliveryNo: "desc" },
        select: { deliveryNo: true },
      });
      const deliveryNo = (last?.deliveryNo ?? 0) + 1;

      const dn = await tx.deliveryNote.create({
        data: {
          ticketId,
          callOffId: callOffId ?? undefined,
          deliveryNo,
          deliveryDate,
          signedBy,
          notes,
          lines: {
            create: lines.map((l) => ({
              ticketLineId: l.ticketLineId,
              qtyDelivered: l.qtyDelivered,
              qtyBackOrder: l.qtyBackOrder ?? 0,
              status: l.status,
            })),
          },
        },
        include: { lines: true },
      });

      // If scoped to a call-off, recompute its delivery status from total
      // qtyDelivered (across all DNs on this call-off) vs requestedQty.
      if (callOffId) {
        const callOff = await tx.callOff.findUnique({
          where: { id: callOffId },
          select: {
            id: true,
            status: true,
            lines: { select: { ticketLineId: true, requestedQty: true } },
          },
        });
        if (callOff) {
          const dnAgg = await tx.deliveryNoteLine.groupBy({
            by: ["ticketLineId"],
            where: { deliveryNote: { callOffId } },
            _sum: { qtyDelivered: true },
          });
          const deliveredByTLine = new Map<string, number>();
          for (const g of dnAgg) {
            deliveredByTLine.set(g.ticketLineId, Number(g._sum.qtyDelivered ?? 0));
          }
          const allDelivered = callOff.lines.every(
            (l) => (deliveredByTLine.get(l.ticketLineId) ?? 0) >= Number(l.requestedQty) - 1e-6
          );
          const anyDelivered = callOff.lines.some(
            (l) => (deliveredByTLine.get(l.ticketLineId) ?? 0) > 0
          );
          const next = allDelivered
            ? "DELIVERED"
            : anyDelivered
              ? "PARTIALLY_DELIVERED"
              : "OPEN";
          if (next !== callOff.status) {
            await tx.callOff.update({ where: { id: callOffId }, data: { status: next } });
          }
        }
      }

      return dn;
    });

    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error("Failed to create delivery note:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create delivery note" },
      { status: 500 }
    );
  }
}

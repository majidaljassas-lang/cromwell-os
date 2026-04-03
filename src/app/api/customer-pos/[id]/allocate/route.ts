import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const {
      ticketLineId,
      salesInvoiceId,
      allocatedValue,
      status = "ALLOCATED",
    } = body;

    if (!ticketLineId || allocatedValue === undefined) {
      return Response.json(
        { error: "Missing required fields: ticketLineId, allocatedValue" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const allocation = await tx.customerPOAllocation.create({
        data: {
          customerPOId: id,
          ticketLineId,
          salesInvoiceId,
          allocatedValue,
          status,
        },
        include: {
          ticketLine: true,
          salesInvoice: true,
        },
      });

      const po = await tx.customerPO.findUniqueOrThrow({
        where: { id },
      });

      const currentCommitted = Number(po.poCommittedValue) || 0;
      const currentRemaining = Number(po.poRemainingValue) || 0;
      const alloc = Number(allocatedValue);

      await tx.customerPO.update({
        where: { id },
        data: {
          poCommittedValue: currentCommitted + alloc,
          poRemainingValue: currentRemaining - alloc,
        },
      });

      return allocation;
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create PO allocation:", error);
    return Response.json(
      { error: "Failed to create PO allocation" },
      { status: 500 }
    );
  }
}

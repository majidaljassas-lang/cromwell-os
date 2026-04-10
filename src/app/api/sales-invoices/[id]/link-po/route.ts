import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { poNo, customerPOId } = body;

    if (!poNo) {
      return Response.json(
        { error: "Missing required field: poNo" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.update({
        where: { id },
        data: { poNo },
        include: {
          lines: true,
        },
      });

      if (customerPOId && invoice.lines.length > 0) {
        await tx.customerPOAllocation.createMany({
          data: invoice.lines.map((line) => ({
            customerPOId,
            ticketLineId: line.ticketLineId,
            salesInvoiceId: id,
            allocatedValue: line.lineTotal,
            status: "ALLOCATED",
          })),
        });
      }

      return tx.salesInvoice.findUnique({
        where: { id },
        include: {
          ticket: true,
          customer: true,
          site: true,
          lines: {
            include: { ticketLine: true },
          },
          poAllocations: {
            include: { customerPO: true },
          },
        },
      });
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to link PO to invoice:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to link PO to invoice" },
      { status: 500 }
    );
  }
}

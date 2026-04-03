import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        ticket: true,
        customer: true,
        site: true,
        siteCommercialLink: true,
        lines: {
          include: {
            ticketLine: true,
          },
        },
        poAllocations: {
          include: {
            customerPO: true,
          },
        },
      },
    });

    if (!invoice) {
      return Response.json({ error: "Invoice not found" }, { status: 404 });
    }

    return Response.json(invoice);
  } catch (error) {
    console.error("Failed to get sales invoice:", error);
    return Response.json(
      { error: "Failed to get sales invoice" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { status, invoiceNo, issuedAt, paidAt, notes, poNo } = body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (invoiceNo !== undefined) data.invoiceNo = invoiceNo;
    if (issuedAt !== undefined) data.issuedAt = issuedAt ? new Date(issuedAt) : null;
    if (paidAt !== undefined) data.paidAt = paidAt ? new Date(paidAt) : null;
    if (notes !== undefined) data.notes = notes;
    if (poNo !== undefined) data.poNo = poNo;

    const invoice = await prisma.salesInvoice.update({
      where: { id },
      data,
      include: {
        ticket: true,
        customer: true,
        site: true,
        lines: true,
        poAllocations: true,
      },
    });

    return Response.json(invoice);
  } catch (error) {
    console.error("Failed to update sales invoice:", error);
    return Response.json(
      { error: "Failed to update sales invoice" },
      { status: 500 }
    );
  }
}

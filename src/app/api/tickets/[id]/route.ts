import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        lines: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
        events: true,
        tasks: true,
        evidenceFragments: true,
        recoveryCases: true,
      },
    });
    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }
    return Response.json(ticket);
  } catch (error) {
    console.error("Failed to get ticket:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get ticket" },
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
    const ticket = await prisma.ticket.update({
      where: { id },
      data: body,
    });

    // Auto-draft invoice when ticket reaches DELIVERED or COSTED
    if (body.status === "DELIVERED" || body.status === "COSTED") {
      const existingInvoice = await prisma.salesInvoice.findFirst({ where: { ticketId: id } });
      if (!existingInvoice) {
        const fullTicket = await prisma.ticket.findUnique({
          where: { id },
          include: {
            lines: true,
            customerPOs: { take: 1, orderBy: { createdAt: "desc" as const } },
          },
        });

        if (fullTicket) {
          const pricedLines = fullTicket.lines.filter(
            (line) => line.actualSaleUnit !== null || line.actualSaleTotal !== null
          );
          const totalSell = pricedLines.reduce((sum, line) => sum + Number(line.actualSaleTotal || 0), 0);
          const invoiceNo = `INV-AUTO-${Date.now()}`;
          const poRef = fullTicket.customerPOs[0]?.poNo || null;

          const invoice = await prisma.salesInvoice.create({
            data: {
              ticketId: id,
              invoiceNo,
              customerId: fullTicket.payingCustomerId,
              siteId: fullTicket.siteId || undefined,
              siteCommercialLinkId: fullTicket.siteCommercialLinkId || undefined,
              poNo: poRef,
              invoiceType: "STANDARD",
              status: "DRAFT",
              totalSell,
              notes: `Auto-drafted when ticket reached ${body.status}`,
            },
          });

          if (pricedLines.length > 0) {
            await prisma.salesInvoiceLine.createMany({
              data: pricedLines.map((line) => ({
                salesInvoiceId: invoice.id,
                ticketLineId: line.id,
                description: line.description,
                qty: line.qty,
                unitPrice: line.actualSaleUnit || 0,
                lineTotal: line.actualSaleTotal || 0,
                displayMode: "LINE",
              })),
            });
          }

          await prisma.event.create({
            data: {
              ticketId: id,
              eventType: "AUTO_INVOICE_DRAFTED",
              timestamp: new Date(),
              notes: `Draft invoice ${invoice.invoiceNo} auto-created (${pricedLines.length} lines, £${totalSell.toFixed(2)})${poRef ? ` — PO ref: ${poRef}` : ""}`,
            },
          });
        }
      }
    }

    return Response.json(ticket);
  } catch (error) {
    console.error("Failed to update ticket:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update ticket" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Delete related records first
    await prisma.customerPO.deleteMany({ where: { ticketId: id } });
    await prisma.quote.deleteMany({ where: { ticketId: id } });
    await prisma.ticketLine.deleteMany({ where: { ticketId: id } });
    await prisma.event.deleteMany({ where: { ticketId: id } });
    await prisma.ticket.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete ticket:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete ticket" }, { status: 500 });
  }
}

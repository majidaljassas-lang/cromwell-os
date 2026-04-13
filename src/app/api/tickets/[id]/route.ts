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
    // Block if sent/paid invoices exist
    const sentInvoices = await prisma.salesInvoice.count({
      where: { ticketId: id, status: { notIn: ["DRAFT", "VOIDED"] } },
    });
    if (sentInvoices > 0) {
      return Response.json({ error: "Cannot delete — ticket has sent/paid invoices." }, { status: 409 });
    }

    const lineIds = (await prisma.ticketLine.findMany({ where: { ticketId: id }, select: { id: true } })).map(l => l.id);
    const invoiceIds = (await prisma.salesInvoice.findMany({ where: { ticketId: id }, select: { id: true } })).map(i => i.id);
    const quoteIds = (await prisma.quote.findMany({ where: { ticketId: id }, select: { id: true } })).map(q => q.id);
    const poIds = (await prisma.procurementOrder.findMany({ where: { ticketId: id }, select: { id: true } })).map(p => p.id);
    const custPoIds = (await prisma.customerPO.findMany({ where: { ticketId: id }, select: { id: true } })).map(p => p.id);
    const packIds = (await prisma.evidencePack.findMany({ where: { ticketId: id }, select: { id: true } })).map(p => p.id);

    // Clean up in dependency order
    if (invoiceIds.length) {
      await prisma.salesInvoiceLine.deleteMany({ where: { salesInvoiceId: { in: invoiceIds } } });
      await prisma.customerPOAllocation.deleteMany({ where: { salesInvoiceId: { in: invoiceIds } } });
      await prisma.payment.deleteMany({ where: { salesInvoiceId: { in: invoiceIds } } });
    }
    await prisma.salesInvoice.deleteMany({ where: { ticketId: id } });

    if (poIds.length) {
      await prisma.costAllocation.deleteMany({ where: { supplierBillLine: undefined, ticketLineId: { in: lineIds } } }).catch(() => {});
      await prisma.procurementOrderLine.deleteMany({ where: { procurementOrderId: { in: poIds } } });
    }
    await prisma.procurementOrder.deleteMany({ where: { ticketId: id } });

    if (lineIds.length) {
      await prisma.costAllocation.deleteMany({ where: { ticketLineId: { in: lineIds } } });
      await prisma.stockUsage.deleteMany({ where: { ticketLineId: { in: lineIds } } });
    }
    await prisma.absorbedCostAllocation.deleteMany({ where: { ticketId: id } });

    if (quoteIds.length) {
      await prisma.quoteLine.deleteMany({ where: { quoteId: { in: quoteIds } } });
    }
    await prisma.quote.deleteMany({ where: { ticketId: id } });

    if (custPoIds.length) {
      await prisma.labourDrawdown.deleteMany({ where: { customerPOId: { in: custPoIds } } }).catch(() => {});
      await prisma.materialsDrawdown.deleteMany({ where: { customerPOId: { in: custPoIds } } }).catch(() => {});
      await prisma.customerPOLine.deleteMany({ where: { customerPOId: { in: custPoIds } } }).catch(() => {});
    }
    await prisma.customerPO.deleteMany({ where: { ticketId: id } });

    if (packIds.length) {
      await prisma.evidencePackItem.deleteMany({ where: { evidencePackId: { in: packIds } } });
    }
    await prisma.evidencePack.deleteMany({ where: { ticketId: id } });
    await prisma.evidenceFragment.deleteMany({ where: { ticketId: id } });
    await prisma.task.deleteMany({ where: { ticketId: id } });
    await prisma.event.deleteMany({ where: { ticketId: id } });
    await prisma.ticketLine.deleteMany({ where: { ticketId: id } });
    await prisma.ticket.delete({ where: { id } });

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete ticket:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete ticket" }, { status: 500 });
  }
}

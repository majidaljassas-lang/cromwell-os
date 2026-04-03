import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const {
      customerId,
      invoiceType = "STANDARD",
      notes,
    } = body;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        lines: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
      },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    const readinessWarnings: string[] = [];

    // Check lines with status CAPTURED or missing pricing
    const unpricedLines = ticket.lines.filter(
      (line) =>
        line.status === "CAPTURED" ||
        line.actualSaleTotal === null ||
        Number(line.actualSaleTotal) === 0
    );
    if (unpricedLines.length > 0) {
      readinessWarnings.push(
        `${unpricedLines.length} line(s) have status CAPTURED or missing sale total`
      );
    }

    // Fix 1: Check for BLOCKED_VAT_UNKNOWN bill lines on this ticket
    const blockedVatLines = await prisma.supplierBillLine.findMany({
      where: { ticketId: id, commercialStatus: "BLOCKED_VAT_UNKNOWN" },
      select: { id: true, description: true },
    });
    if (blockedVatLines.length > 0) {
      readinessWarnings.push(
        `${blockedVatLines.length} bill line(s) have UNKNOWN VAT basis and are blocked: ${blockedVatLines.map((l) => l.description).join(", ")}`
      );
    }

    // Check open blocker tasks
    const openBlockerTasks = await prisma.task.findMany({
      where: {
        ticketId: id,
        status: { notIn: ["COMPLETED", "CLOSED"] },
      },
    });
    if (openBlockerTasks.length > 0) {
      readinessWarnings.push(
        `${openBlockerTasks.length} open task(s) not yet completed or closed`
      );
    }

    // Check PO requirement
    if (ticket.poRequired) {
      const linkedPOs = await prisma.customerPO.findMany({
        where: {
          ticketId: id,
          status: { contains: "RECEIVED" },
        },
      });
      if (linkedPOs.length === 0) {
        readinessWarnings.push(
          "Ticket requires PO but no linked PO with RECEIVED status found"
        );
      }
    }

    // Build invoice lines from priced ticket lines
    const pricedLines = ticket.lines.filter(
      (line) =>
        line.actualSaleUnit !== null || line.actualSaleTotal !== null
    );

    const totalSell = pricedLines.reduce(
      (sum, line) => sum + Number(line.actualSaleTotal || 0),
      0
    );

    const invoiceNo = `INV-${Date.now()}`;
    const resolvedCustomerId = customerId || ticket.payingCustomerId;

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.salesInvoice.create({
        data: {
          ticketId: id,
          invoiceNo,
          customerId: resolvedCustomerId,
          siteId: ticket.siteId,
          siteCommercialLinkId: ticket.siteCommercialLinkId,
          invoiceType,
          status: "DRAFT",
          totalSell,
          notes,
        },
      });

      if (pricedLines.length > 0) {
        await tx.salesInvoiceLine.createMany({
          data: pricedLines.map((line) => ({
            salesInvoiceId: created.id,
            ticketLineId: line.id,
            description: line.description,
            qty: line.qty,
            unitPrice: line.actualSaleUnit || 0,
            lineTotal: line.actualSaleTotal || 0,
            displayMode: "LINE",
          })),
        });
      }

      return tx.salesInvoice.findUnique({
        where: { id: created.id },
        include: {
          ticket: true,
          customer: true,
          site: true,
          siteCommercialLink: true,
          lines: {
            include: { ticketLine: true },
          },
          poAllocations: true,
        },
      });
    });

    return Response.json(
      { ...invoice, readinessWarnings },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to generate invoice draft:", error);
    return Response.json(
      { error: "Failed to generate invoice draft" },
      { status: 500 }
    );
  }
}

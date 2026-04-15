import { prisma } from "@/lib/prisma";

/**
 * POST /api/customer-pos/[id]/build-invoice
 * Creates a SalesInvoice from a CustomerPO. Inherits:
 * - customer, site, ticket from PO
 * - poNo (header)
 * - lines from PO lines (if any)
 * - total values
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const customLines: Array<{ description: string; qty: number; unitPrice: number }> = body.lines || [];

    const po = await prisma.customerPO.findUnique({
      where: { id },
      include: {
        lines: { include: { ticketLine: true } },
        customer: true,
        site: true,
        ticket: { include: { lines: true } },
      },
    });

    if (!po) return Response.json({ error: "PO not found" }, { status: 404 });

    // Determine ticketId — PO's linked ticket, or auto-create one
    let ticketId = po.ticketId;
    if (!ticketId) {
      // Auto-create a ticket for this PO so we can invoice
      const lastTicket = await prisma.ticket.findFirst({ orderBy: { ticketNo: "desc" }, select: { ticketNo: true } });
      const nextTicketNo = (lastTicket?.ticketNo || 0) + 1;
      const newTicket = await prisma.ticket.create({
        data: {
          ticketNo: nextTicketNo,
          title: `${po.customer.name}${po.site?.siteName ? " — " + po.site.siteName : ""} — PO ${po.poNo}`,
          ticketMode: "DIRECT_ORDER",
          status: "INVOICED",
          revenueState: "OPERATIONAL",
          payingCustomerId: po.customerId,
          siteId: po.siteId,
          siteCommercialLinkId: po.siteCommercialLinkId || undefined,
          poRequired: true,
          poStatus: "RECEIVED",
        },
      });
      ticketId = newTicket.id;

      // Link the PO to the new ticket
      await prisma.customerPO.update({
        where: { id },
        data: { ticketId },
      });
    }

    const invoiceNo = `INV-${Date.now()}`;
    const totalSell = Number(po.totalValue ?? po.poLimitValue ?? 0);

    // Create invoice with lines from PO
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.salesInvoice.create({
        data: {
          ticketId,
          invoiceNo,
          customerId: po.customerId,
          siteId: po.siteId,
          siteCommercialLinkId: po.siteCommercialLinkId || undefined,
          poNo: po.poNo,
          invoiceType: "STANDARD",
          status: "DRAFT",
          totalSell,
          notes: `Built from PO ${po.poNo}`,
        },
      });

      // Priority: custom lines from request body > PO lines > generic line
      if (customLines.length > 0) {
        for (const cl of customLines) {
          const qty = Number(cl.qty || 1);
          const unitPrice = Number(cl.unitPrice || 0);
          const lineTotal = qty * unitPrice;

          // Create a ticket line for this invoice line
          const newTicketLine = await tx.ticketLine.create({
            data: {
              ticketId,
              lineType: "MATERIAL",
              description: cl.description,
              qty,
              unit: "EA",
              expectedCostUnit: 0,
              actualSaleUnit: unitPrice,
              actualSaleTotal: lineTotal,
              payingCustomerId: po.customerId,
              siteId: po.siteId,
              status: "INVOICED",
            },
          });

          await tx.salesInvoiceLine.create({
            data: {
              salesInvoiceId: created.id,
              ticketLineId: newTicketLine.id,
              description: cl.description,
              qty,
              unitPrice,
              lineTotal,
              displayMode: "LINE",
              poMatched: true,
              poMatchStatus: "MATCHED",
            },
          });
        }
        // Update invoice total
        const computedTotal = customLines.reduce((s, cl) => s + (Number(cl.qty || 1) * Number(cl.unitPrice || 0)), 0);
        await tx.salesInvoice.update({
          where: { id: created.id },
          data: { totalSell: computedTotal },
        });
      } else if (po.lines.length > 0) {
        for (const poLine of po.lines) {
          const qty = Number(poLine.qty || 1);
          const unitPrice = Number(poLine.agreedUnitPrice || 0);
          const lineTotal = Number(poLine.agreedTotal || (qty * unitPrice));

          // Need a ticketLine — if PO line has one, use it; otherwise create a new ticket line
          let ticketLineId = poLine.ticketLineId;
          if (!ticketLineId) {
            // Create a ticket line from the PO line
            const newTicketLine = await tx.ticketLine.create({
              data: {
                ticketId,
                lineType: "MATERIAL",
                description: poLine.description,
                qty,
                unit: "EA",
                expectedCostUnit: 0,
                actualSaleUnit: unitPrice,
                actualSaleTotal: lineTotal,
                payingCustomerId: po.customerId,
                siteId: po.siteId,
                status: "INVOICED",
              },
            });
            ticketLineId = newTicketLine.id;
          }

          await tx.salesInvoiceLine.create({
            data: {
              salesInvoiceId: created.id,
              ticketLineId,
              description: poLine.description,
              qty,
              unitPrice,
              lineTotal,
              displayMode: "LINE",
              poMatched: true,
              poMatchStatus: "MATCHED",
            },
          });
        }
      } else {
        // PO has no lines — create a single line from PO total
        const ticketLine = await tx.ticketLine.create({
          data: {
            ticketId,
            lineType: "MATERIAL",
            description: `PO ${po.poNo} - ${po.notes || "items"}`,
            qty: 1,
            unit: "LOT",
            expectedCostUnit: 0,
            actualSaleUnit: totalSell,
            actualSaleTotal: totalSell,
            payingCustomerId: po.customerId,
            siteId: po.siteId,
            status: "INVOICED",
          },
        });

        await tx.salesInvoiceLine.create({
          data: {
            salesInvoiceId: created.id,
            ticketLineId: ticketLine.id,
            description: `PO ${po.poNo} - ${po.notes || "items"}`,
            qty: 1,
            unitPrice: totalSell,
            lineTotal: totalSell,
            displayMode: "LINE",
            poMatched: true,
            poMatchStatus: "MATCHED",
          },
        });
      }

      // Update the CustomerPO with the invoice number for bidirectional linking
      await tx.customerPO.update({
        where: { id },
        data: { invoiceNo },
      });

      return created;
    });

    // Auto-trigger PO match on the new invoice
    try {
      const matchUrl = new URL(`/api/sales-invoices/${invoice.id}/match-po`, request.url);
      await fetch(matchUrl.toString(), { method: "POST" }).catch(() => {});
    } catch {}

    return Response.json({
      ok: true,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      message: `Invoice ${invoiceNo} created from PO ${po.poNo}`,
    }, { status: 201 });
  } catch (error) {
    console.error("Build invoice from PO failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

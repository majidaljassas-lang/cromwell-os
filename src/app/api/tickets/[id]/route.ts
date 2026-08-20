import { prisma } from "@/lib/prisma";
import { STANDARD_VAT_RATE, lineVat } from "@/lib/finance/invoice-totals";

const r2 = (n: number) => Math.round(n * 100) / 100;

const PRE_TRANSACTIONAL_STATUSES = new Set(["CAPTURED", "PRICING", "QUOTED"]);
const TRANSACTIONAL_STATUSES = new Set([
  "APPROVED", "ORDERED", "DELIVERED", "COSTED",
  "PENDING_PO", "RECOVERY", "VERIFIED", "LOCKED", "INVOICED", "CLOSED",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        lines: { orderBy: [{ displayOrder: "asc" }, { id: "asc" }] },
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

    // Reassign flow: when caller changes customer/site, resolve the matching
    // active SiteCommercialLink server-side so the client doesn't have to.
    if (
      Object.prototype.hasOwnProperty.call(body, "payingCustomerId") ||
      Object.prototype.hasOwnProperty.call(body, "siteId")
    ) {
      const current = await prisma.ticket.findUnique({
        where: { id },
        select: { payingCustomerId: true, siteId: true },
      });
      const nextCustomerId =
        body.payingCustomerId !== undefined ? body.payingCustomerId : current?.payingCustomerId ?? null;
      const nextSiteId =
        body.siteId !== undefined ? body.siteId : current?.siteId ?? null;
      if (nextCustomerId && nextSiteId) {
        const link = await prisma.siteCommercialLink.findFirst({
          where: { customerId: nextCustomerId, siteId: nextSiteId, isActive: true },
          select: { id: true },
        });
        body.siteCommercialLinkId = link?.id ?? null;
      } else {
        body.siteCommercialLinkId = null;
      }
    }

    if (typeof body.status === "string" && TRANSACTIONAL_STATUSES.has(body.status)) {
      const current = await prisma.ticket.findUnique({
        where: { id },
        select: { siteId: true, status: true },
      });
      if (!current) {
        return Response.json({ error: "Ticket not found" }, { status: 404 });
      }
      const resolvedSiteId = body.siteId ?? current.siteId;
      if (!resolvedSiteId) {
        return Response.json(
          {
            error: "SITE_REQUIRED",
            message: `Cannot move ticket from ${current.status} to ${body.status} without a site. ` +
              `A site must be assigned before the ticket enters any transactional state ` +
              `(orders, deliveries, invoices). Quoting phase does not require a site.`,
            currentStatus: current.status,
            attemptedStatus: body.status,
            field: "siteId",
          },
          { status: 422 },
        );
      }
    }

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
          const totalNet = r2(pricedLines.reduce((sum, line) => sum + Number(line.actualSaleTotal || 0), 0));
          const totalVat = r2(totalNet * (STANDARD_VAT_RATE / 100));
          const totalGross = r2(totalNet + totalVat);
          const invoiceNo = `INV-AUTO-${Date.now()}`;
          const poRef = fullTicket.customerPOs[0]?.poNo || null;

          if (!fullTicket.siteId) {
            throw new Error("Invariant violated: ticket reached transactional state without siteId");
          }
          const issuedAt = new Date();
          const dueDate = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
          const invoice = await prisma.salesInvoice.create({
            data: {
              ticketId: id,
              invoiceNo,
              customerId: fullTicket.payingCustomerId,
              siteId: fullTicket.siteId,
              siteCommercialLinkId: fullTicket.siteCommercialLinkId || undefined,
              poNo: poRef,
              invoiceType: "STANDARD",
              status: "DRAFT",
              issuedAt,
              dueDate,
              totalSell: totalGross,
              totalNet,
              totalVat,
              totalGross,
              notes: `Auto-drafted when ticket reached ${body.status}`,
            },
          });

          if (pricedLines.length > 0) {
            await prisma.salesInvoiceLine.createMany({
              data: pricedLines.map((line, i) => {
                const lineNet = Number(line.actualSaleTotal || 0);
                return {
                  salesInvoiceId: invoice.id,
                  ticketLineId: line.id,
                  description: line.description,
                  qty: line.qty,
                  unitPrice: line.actualSaleUnit || 0,
                  lineTotal: line.actualSaleTotal || 0,
                  vatRate: STANDARD_VAT_RATE,
                  vatAmount: lineVat(lineNet),
                  displayMode: "LINE",
                  displayOrder: i + 1,
                };
              }),
            });
          }

          await prisma.event.create({
            data: {
              ticketId: id,
              eventType: "AUTO_INVOICE_DRAFTED",
              timestamp: new Date(),
              notes: `Draft invoice ${invoice.invoiceNo} auto-created (${pricedLines.length} lines, £${totalGross.toFixed(2)} gross)${poRef ? ` — PO ref: ${poRef}` : ""}`,
            },
          });

          if (poRef) {
            try {
              const matchUrl = new URL(`/api/sales-invoices/${invoice.id}/match-po`, request.url);
              await fetch(matchUrl.toString(), { method: "POST" }).catch(() => {});
            } catch {}
          }
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
      await prisma.labourDrawdownEntry.deleteMany({ where: { customerPOId: { in: custPoIds } } });
      await prisma.materialsDrawdownEntry.deleteMany({ where: { customerPOId: { in: custPoIds } } });
      await prisma.customerPOLine.deleteMany({ where: { customerPOId: { in: custPoIds } } });
    }
    await prisma.customerPO.deleteMany({ where: { ticketId: id } });

    // Drawdowns logged against a *standing* PO (e.g. a materials drawdown PO)
    // reference this ticket but sit under a PO the ticket doesn't own, so the
    // by-customerPOId cleanup above misses them. Remove them by ticketId — the
    // required MaterialsDrawdownEntry.ticketId FK would otherwise block the
    // ticket delete — then restore each surviving PO's consumed/remaining from
    // its remaining entries (deleteMany doesn't decrement the counters).
    const standingDrawdowns = await prisma.materialsDrawdownEntry.findMany({
      where: { ticketId: id },
      select: { customerPOId: true },
    });
    const affectedPoIds = [...new Set(standingDrawdowns.map((d) => d.customerPOId))];
    await prisma.materialsDrawdownEntry.deleteMany({ where: { ticketId: id } });
    await prisma.labourDrawdownEntry.deleteMany({ where: { ticketId: id } });
    for (const poId of affectedPoIds) {
      const po = await prisma.customerPO.findUnique({
        where: { id: poId },
        select: { poLimitValue: true },
      });
      if (!po) continue; // PO itself was deleted with the ticket
      const agg = await prisma.materialsDrawdownEntry.aggregate({
        where: { customerPOId: poId },
        _sum: { sellValue: true },
      });
      const consumed = r2(Number(agg._sum.sellValue ?? 0));
      const limit = Number(po.poLimitValue ?? 0);
      await prisma.customerPO.update({
        where: { id: poId },
        data: { poConsumedValue: consumed, poRemainingValue: r2(limit - consumed) },
      });
    }

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

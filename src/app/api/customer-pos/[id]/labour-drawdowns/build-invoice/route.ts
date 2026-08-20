/**
 * POST /api/customer-pos/[id]/labour-drawdowns/build-invoice
 *
 * Build a SalesInvoice from selected LOGGED LabourDrawdownEntries on a PO.
 * Each entry becomes one SalesInvoiceLine on a freshly created TicketLine.
 * Entries get marked INVOICED with invoiceNo / invoiceDate / invoiceLineId.
 *
 * Body: { entryIds: string[]; notes?: string }
 *
 * Output: { invoiceId, invoiceNo, totalSell, lineCount }
 */
import { prisma } from "@/lib/prisma";
import { STANDARD_VAT_RATE, lineVat, recomputeInvoiceTotals } from "@/lib/finance/invoice-totals";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      entryIds?: string[];
      notes?: string;
    };
    const entryIds = body.entryIds ?? [];
    if (entryIds.length === 0) {
      return Response.json({ error: "entryIds required" }, { status: 400 });
    }

    const po = await prisma.customerPO.findUnique({
      where: { id: poId },
      include: {
        customer: { select: { id: true, name: true } },
        site: { select: { id: true, siteName: true } },
      },
    });
    if (!po) return Response.json({ error: "PO not found" }, { status: 404 });

    const entries = await prisma.labourDrawdownEntry.findMany({
      where: { id: { in: entryIds }, customerPOId: poId },
      include: { plumberContact: { select: { fullName: true } } },
      orderBy: { workDate: "asc" },
    });
    if (entries.length === 0) {
      return Response.json(
        { error: "No matching entries found on this PO" },
        { status: 404 }
      );
    }
    const notLogged = entries.filter((e) => e.status !== "LOGGED");
    if (notLogged.length > 0) {
      return Response.json(
        {
          error: `${notLogged.length} entries are not in LOGGED status (already invoiced or otherwise)`,
        },
        { status: 400 }
      );
    }

    const totalSell = entries.reduce(
      (s, e) => s + Number(e.billableValue),
      0
    );

    // Determine ticket: prefer a ticket already shared by the entries, else
    // the PO's ticket, else auto-create a labour ticket for this PO.
    const distinctTicketIds = Array.from(
      new Set(entries.map((e) => e.ticketId).filter((t): t is string => !!t))
    );
    let ticketId: string | null = null;
    if (distinctTicketIds.length === 1) {
      ticketId = distinctTicketIds[0];
    } else if (po.ticketId) {
      ticketId = po.ticketId;
    }

    if (!po.siteId) {
      return Response.json(
        { error: "PO has no site — assign one before invoicing labour" },
        { status: 422 }
      );
    }

    const invoiceNo = `INV-${Date.now()}`;
    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    const result = await prisma.$transaction(async (tx) => {
      // Auto-create labour ticket if needed (mirrors build-invoice flow)
      if (!ticketId) {
        const lastTicket = await tx.ticket.findFirst({
          orderBy: { ticketNo: "desc" },
          select: { ticketNo: true },
        });
        const newTicket = await tx.ticket.create({
          data: {
            ticketNo: (lastTicket?.ticketNo || 0) + 1,
            title: `${po.customer.name}${po.site?.siteName ? " — " + po.site.siteName : ""} — Labour PO ${po.poNo}`,
            ticketMode: "DIRECT_ORDER",
            status: "INVOICED",
            revenueState: "OPERATIONAL",
            payingCustomerId: po.customerId,
            siteId: po.siteId!,
            siteCommercialLinkId: po.siteCommercialLinkId || undefined,
            poRequired: true,
            poStatus: "RECEIVED",
          },
        });
        ticketId = newTicket.id;
        if (!po.ticketId) {
          await tx.customerPO.update({
            where: { id: poId },
            data: { ticketId: newTicket.id },
          });
        }
      }

      const inv = await tx.salesInvoice.create({
        data: {
          ticketId: ticketId!,
          invoiceNo,
          customerId: po.customerId,
          siteId: po.siteId!,
          siteCommercialLinkId: po.siteCommercialLinkId || undefined,
          poNo: po.poNo,
          invoiceType: "STANDARD",
          status: "DRAFT",
          issuedAt,
          dueDate,
          totalSell,
          notes:
            body.notes ?? `Labour drawdown — PO ${po.poNo} — ${entries.length} day(s)`,
        },
      });

      let lineSeq = 0;
      for (const entry of entries) {
        lineSeq++;
        const date = new Date(entry.workDate).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        const plumber = entry.plumberContact?.fullName ?? null;
        const days = Number(entry.daysWorked);
        const rate = Number(entry.billableDayRate);
        const description = [
          `Labour — ${date}`,
          plumber ? `(${plumber})` : null,
          `${days} ${days === 1 ? "day" : "days"} @ £${rate.toFixed(2)}/day`,
          entry.dayType === "WEEKEND" ? "[Weekend]" : null,
        ]
          .filter(Boolean)
          .join(" ");

        // Create a TicketLine specifically for this labour day
        const tline = await tx.ticketLine.create({
          data: {
            ticketId: ticketId!,
            lineType: "LABOUR",
            description,
            qty: days,
            unit: "EA",
            expectedCostUnit: Number(entry.internalDayCost),
            expectedCostTotal: Number(entry.internalCostValue),
            actualSaleUnit: rate,
            actualSaleTotal: Number(entry.billableValue),
            payingCustomerId: po.customerId,
            siteId: po.siteId!,
            status: "INVOICED",
          },
        });

        const lineNet = Number(entry.billableValue);
        const sil = await tx.salesInvoiceLine.create({
          data: {
            salesInvoiceId: inv.id,
            ticketLineId: tline.id,
            description,
            qty: days,
            unitPrice: rate,
            lineTotal: lineNet,
            vatRate: STANDARD_VAT_RATE,
            vatAmount: lineVat(lineNet),
            displayMode: "LINE",
            displayOrder: lineSeq,
            poMatched: true,
            poMatchStatus: "MATCHED",
          },
        });

        await tx.labourDrawdownEntry.update({
          where: { id: entry.id },
          data: {
            status: "INVOICED",
            invoiceLineId: sil.id,
            invoiceNo,
            invoiceDate: issuedAt,
          },
        });
      }

      await recomputeInvoiceTotals(tx, inv.id);
      return inv;
    });

    return Response.json(
      {
        ok: true,
        invoiceId: result.id,
        invoiceNo: result.invoiceNo,
        totalSell,
        lineCount: entries.length,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error(
      "/api/customer-pos/[id]/labour-drawdowns/build-invoice failed:",
      e
    );
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}

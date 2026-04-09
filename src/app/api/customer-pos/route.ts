import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const poType = searchParams.get("poType");
    const customerId = searchParams.get("customerId");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (poType)
      where.poType = poType as
        | "STANDARD_FIXED"
        | "DRAWDOWN_LABOUR"
        | "DRAWDOWN_MATERIALS";
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const pos = await prisma.customerPO.findMany({
      where,
      include: {
        customer: true,
        site: true,
        siteCommercialLink: true,
        ticket: true,
        lines: true,
        _count: {
          select: {
            labourDrawdowns: true,
            materialsDrawdowns: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(pos);
  } catch (error) {
    console.error("Failed to list customer POs:", error);
    return Response.json(
      { error: "Failed to list customer POs" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      ticketId,
      customerId,
      siteId,
      siteCommercialLinkId,
      issuedByContactId,
      issuedBy,
      poNo,
      poType,
      poDate,
      status = "RECEIVED",
      totalValue,
      poLimitValue,
      overheadPct,
      overheadBasis,
      weekdaySellRate,
      weekendSellRate,
      weekdayCostRate,
      weekendCostRate,
      sourceAttachmentRef,
      notes,
    } = body;

    if (!customerId || !poNo || !poType) {
      return Response.json(
        { error: "Missing required fields: customerId, poNo, poType" },
        { status: 400 }
      );
    }

    const poRemainingValue = poLimitValue ?? totalValue ?? 0;

    // Use transaction so ticket + PO are created atomically
    const po = await prisma.$transaction(async (tx) => {
      // Auto-create ticket if none provided
      let resolvedTicketId = ticketId;
      if (!resolvedTicketId) {
        const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true } });
        const site = siteId ? await tx.site.findUnique({ where: { id: siteId }, select: { siteName: true } }) : null;
        const title = site ? `${site.siteName} — ${poNo}` : `${customer?.name || "Unknown"} — ${poNo}`;

        const ticket = await tx.ticket.create({
          data: {
            payingCustomerId: customerId,
            siteId: siteId || undefined,
            title,
            ticketMode: "DIRECT_ORDER",
            status: "APPROVED",
            poRequired: true,
            poStatus: "RECEIVED",
          },
        });
        resolvedTicketId = ticket.id;
      }

      return tx.customerPO.create({
        data: {
          ticketId: resolvedTicketId,
          customerId,
          siteId: siteId || undefined,
          siteCommercialLinkId: siteCommercialLinkId || undefined,
          issuedByContactId: issuedByContactId || undefined,
          issuedBy: issuedBy || undefined,
          poNo,
          poType: poType as
            | "STANDARD_FIXED"
            | "DRAWDOWN_LABOUR"
            | "DRAWDOWN_MATERIALS",
          poDate: poDate ? new Date(poDate) : undefined,
          status,
          totalValue,
          poLimitValue,
          poRemainingValue,
          overheadPct,
          overheadBasis,
          weekdaySellRate,
          weekendSellRate,
          weekdayCostRate,
          weekendCostRate,
          sourceAttachmentRef,
          notes,
        },
        include: {
          customer: true,
          site: true,
          siteCommercialLink: true,
          ticket: true,
          lines: true,
          _count: {
            select: {
              labourDrawdowns: true,
              materialsDrawdowns: true,
            },
          },
        },
      });
    });

    // Auto-populate PO lines from quote lines if ticket has a quote
    if (po.ticketId && poType === "STANDARD_FIXED") {
      const quotes = await prisma.quote.findMany({
        where: { ticketId: po.ticketId },
        include: { lines: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      });
      const quote = quotes[0];
      if (quote && quote.lines.length > 0) {
        await prisma.customerPOLine.createMany({
          data: quote.lines.map((ql) => ({
            customerPOId: po.id,
            ticketLineId: ql.ticketLineId,
            description: ql.description,
            qty: ql.qty,
            agreedUnitPrice: ql.unitPrice,
            agreedTotal: ql.lineTotal,
          })),
        });
      }
    }

    return Response.json(po, { status: 201 });
  } catch (error) {
    console.error("Failed to create customer PO:", error);
    return Response.json(
      { error: "Failed to create customer PO" },
      { status: 500 }
    );
  }
}

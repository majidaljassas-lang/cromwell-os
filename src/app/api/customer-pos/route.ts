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
      { error: error instanceof Error ? error.message : "Failed to list customer POs" },
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

    if (!siteId) {
      return Response.json(
        {
          error: "SITE_REQUIRED",
          message: "A customer PO is transactional activity and requires a site. " +
            "Quotes may exist without a site, but PO creation must specify siteId.",
          field: "siteId",
        },
        { status: 422 }
      );
    }

    // Auto-resolve quoteId from ticket if not explicitly provided
    let resolvedQuoteId = body.quoteId ?? null;
    if (!resolvedQuoteId && ticketId) {
      const latestQuote = await prisma.quote.findFirst({
        where: { ticketId, status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestQuote) {
        resolvedQuoteId = latestQuote.id;
      }
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
            siteId,
            title,
            ticketMode: "DIRECT_ORDER",
            status: "APPROVED",
            poRequired: true,
            poStatus: "RECEIVED",
          },
        });
        resolvedTicketId = ticket.id;
      } else {
        // TRICKLE DOWN: PO added to existing ticket
        // 1. Link site if provided and ticket has none
        // 2. Advance ticket status if appropriate
        // 3. Update title if it's a generic placeholder
        const existingTicket = await tx.ticket.findUnique({
          where: { id: resolvedTicketId },
          select: { siteId: true, status: true, title: true }
        });
        if (existingTicket) {
          const updates: any = { poStatus: "RECEIVED" };

          // Link site if not already linked
          if (siteId && !existingTicket.siteId) {
            updates.siteId = siteId;
          }

          // Update title if it's a placeholder
          if (existingTicket.title === "Quote" || existingTicket.title?.startsWith("Untitled")) {
            const site = siteId ? await tx.site.findUnique({ where: { id: siteId }, select: { siteName: true } }) : null;
            if (site) updates.title = `${site.siteName} — ${poNo}`;
          }

          // Advance status: if at PRICING/QUOTED/CAPTURED, jump to APPROVED
          if (["CAPTURED", "PRICING", "QUOTED"].includes(existingTicket.status)) {
            updates.status = "APPROVED";
          }

          await tx.ticket.update({ where: { id: resolvedTicketId }, data: updates });
        }
      }

      return tx.customerPO.create({
        data: {
          ticketId: resolvedTicketId,
          customerId,
          siteId,
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

    return Response.json(po, { status: 201 });
  } catch (error) {
    console.error("Failed to create customer PO:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create customer PO" },
      { status: 500 }
    );
  }
}

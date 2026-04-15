import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { customerId, ticketId, siteId, issuedBy, poNo, poDate, fileRef, fileName, lines } = body;

    if (!customerId || !poNo) {
      return Response.json({ error: "Customer and PO number are required" }, { status: 400 });
    }

    // CustomerPO is transactional — site is mandatory. Try explicit siteId,
    // then the linked ticket's siteId, then the customer's single billable link.
    let resolvedSiteId: string | null = siteId || null;
    if (!resolvedSiteId && ticketId) {
      const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { siteId: true } });
      resolvedSiteId = t?.siteId ?? null;
    }
    if (!resolvedSiteId) {
      const links = await prisma.siteCommercialLink.findMany({
        where: { customerId, isActive: true, billingAllowed: true },
        orderBy: [{ defaultBillingCustomer: "desc" }],
        select: { siteId: true },
      });
      if (links.length === 1) resolvedSiteId = links[0].siteId;
    }
    if (!resolvedSiteId) {
      return Response.json(
        {
          error: "SITE_REQUIRED",
          message: "A customer PO requires a site. Provide siteId, link to a ticket that has " +
            "a site, or ensure the customer has exactly one active billable SiteCommercialLink.",
          field: "siteId",
        },
        { status: 422 }
      );
    }

    const totalExVat = (lines || []).reduce((s: number, l: any) => s + (l.lineTotal || 0), 0);

    // Auto-create ticket if none provided
    let resolvedTicketId = ticketId;
    if (!resolvedTicketId) {
      const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
      const site = await prisma.site.findUnique({ where: { id: resolvedSiteId }, select: { siteName: true } });
      const title = site ? `${site.siteName} — ${poNo}` : `${customer?.name || "Unknown"} — ${poNo}`;

      const ticket = await prisma.ticket.create({
        data: {
          payingCustomerId: customerId,
          siteId: resolvedSiteId,
          title,
          ticketMode: "DIRECT_ORDER",
          status: "APPROVED",
          poRequired: true,
          poStatus: "RECEIVED",
        },
      });
      resolvedTicketId = ticket.id;
    }

    const po = await prisma.customerPO.create({
      data: {
        customerId,
        ticketId: resolvedTicketId,
        siteId: resolvedSiteId,
        issuedBy: issuedBy || undefined,
        poNo,
        poType: "STANDARD_FIXED",
        poDate: poDate ? new Date(poDate) : new Date(),
        status: "RECEIVED",
        totalValue: totalExVat || undefined,
        poLimitValue: totalExVat || undefined,
        poRemainingValue: totalExVat || undefined,
        sourceAttachmentRef: fileRef || undefined,
        notes: fileName ? `Uploaded from: ${fileName}` : undefined,
      },
    });

    // Create parsed lines
    if (lines && lines.length > 0) {
      await prisma.customerPOLine.createMany({
        data: lines.map((l: any) => ({
          customerPOId: po.id,
          description: l.description,
          qty: l.qty || undefined,
          agreedUnitPrice: l.unitPrice || undefined,
          agreedTotal: l.lineTotal || undefined,
        })),
      });
    }

    // If no parsed lines but ticket has a quote, pull from quote
    if ((!lines || lines.length === 0) && ticketId) {
      const quotes = await prisma.quote.findMany({
        where: { ticketId },
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

    return Response.json({ id: po.id, poNo }, { status: 201 });
  } catch (error) {
    console.error("Failed to confirm PO upload:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create PO" }, { status: 500 });
  }
}

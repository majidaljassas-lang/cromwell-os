import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      siteCommercialLinks: { include: { customer: true } },
      siteContactLinks: { include: { contact: true, customer: true } },
      tickets: {
        include: { payingCustomer: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!site) {
    return Response.json({ error: "Site not found" }, { status: 404 });
  }

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const supplierBillLines = await prisma.supplierBillLine.findMany({
    where: { siteId: id },
    include: {
      supplierBill: { include: { supplier: { select: { id: true, name: true } } } },
      ticket: { select: { id: true, ticketNo: true, title: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const ticketIds = site.tickets.map((t) => t.id);
  const inboxThreads = ticketIds.length
    ? await prisma.inboxThread.findMany({
        where: { linkedTicketId: { in: ticketIds } },
        include: {
          messages: { orderBy: { occurredAt: "desc" }, take: 500 },
          linkedTicket: { select: { id: true, ticketNo: true, title: true } },
        },
        orderBy: { latestAt: "desc" },
      })
    : [];

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return Response.json({
    site: s(site),
    customers: s(customers),
    supplierBillLines: s(supplierBillLines),
    inboxThreads: s(inboxThreads),
  });
}

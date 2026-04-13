import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TicketDetail } from "@/components/tickets/ticket-detail";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      payingCustomer: true,
      site: true,
      siteCommercialLink: true,
      lines: {
        include: {
          payingCustomer: true,
          stockUsages: {
            select: {
              id: true, qtyUsed: true, costPerUnit: true, totalCost: true, stockItemId: true,
              stockItem: { select: { id: true, description: true, supplierName: true, originBillNo: true, sourceType: true, originTicketTitle: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      evidenceFragments: {
        orderBy: { timestamp: "desc" },
      },
      events: {
        orderBy: { timestamp: "desc" },
      },
      tasks: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!ticket) {
    notFound();
  }

  // Fetch quotes with lines and customer
  const quotes = await prisma.quote.findMany({
    where: { ticketId: id },
    include: {
      lines: true,
      customer: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch customers for quote generation
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
  });

  // Fetch additional data sequentially to avoid connection exhaustion on Prisma dev server
  const procurementOrders = await prisma.procurementOrder.findMany({
    where: { ticketId: id },
    include: { supplier: true, lines: { include: { ticketLine: true } } },
    orderBy: { issuedAt: "desc" },
  });
  const costAllocations = await prisma.costAllocation.findMany({
    where: { ticketLine: { ticketId: id } },
    include: { ticketLine: true, supplierBillLine: { include: { supplierBill: true } }, supplier: true },
    orderBy: { createdAt: "desc" },
  });
  const absorbedCostAllocations = await prisma.absorbedCostAllocation.findMany({
    where: { ticketId: id },
    include: { supplierBillLine: true },
    orderBy: { createdAt: "desc" },
  });
  const allSuppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  const customerPOs = await prisma.customerPO.findMany({
    where: { ticketId: id },
    include: {
      customer: true, site: true, lines: true,
      labourDrawdowns: { include: { plumberContact: true }, orderBy: { workDate: "desc" } },
      materialsDrawdowns: { include: { ticketLine: true }, orderBy: { drawdownDate: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  const evidencePacks = await prisma.evidencePack.findMany({
    where: { ticketId: id },
    include: { items: { include: { evidenceFragment: true, event: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  const salesInvoices = await prisma.salesInvoice.findMany({
    where: { ticketId: id },
    include: { lines: true, customer: true, poAllocations: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch holding stock items for procurement
  const stockItems = await prisma.stockItem.findMany({
    where: { outcome: "HOLDING", isActive: true },
    orderBy: { createdAt: "desc" },
  });

  // Fetch sites and commercial links for PO creation
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    orderBy: { siteName: "asc" },
    select: { id: true, siteName: true },
  });
  const commercialLinks = await prisma.siteCommercialLink.findMany({
    where: { isActive: true },
    include: {
      site: { select: { id: true, siteName: true } },
      customer: { select: { id: true, name: true } },
    },
  });

  // Serialize to plain objects — Prisma Decimal/Date objects can't pass to client components
  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-8">
      <TicketDetail
        ticket={s(ticket)}
        quotes={s(quotes)}
        customers={s(customers)}
        procurementOrders={s(procurementOrders)}
        costAllocations={s(costAllocations)}
        absorbedCostAllocations={s(absorbedCostAllocations)}
        suppliers={s(allSuppliers)}
        customerPOs={s(customerPOs)}
        evidencePacks={s(evidencePacks)}
        salesInvoices={s(salesInvoices)}
        sites={s(sites)}
        commercialLinks={s(commercialLinks)}
        stockItems={s(stockItems)}
      />
    </div>
  );
}

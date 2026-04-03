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
      recoveryCases: {
        orderBy: { createdAt: "desc" },
      },
      dealSheets: {
        orderBy: { versionNo: "desc" },
      },
    },
  });

  if (!ticket) {
    notFound();
  }

  // Fetch sales bundles with cost links
  const salesBundles = await prisma.salesBundle.findMany({
    where: { ticketId: id },
    include: {
      costLinks: {
        include: {
          ticketLine: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

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

  // Fetch procurement data, customer POs, evidence packs, and sales invoices for this ticket
  const [procurementOrders, costAllocations, absorbedCostAllocations, allSuppliers, customerPOs, evidencePacks, salesInvoices] =
    await Promise.all([
      prisma.procurementOrder.findMany({
        where: { ticketId: id },
        include: {
          supplier: true,
          lines: {
            include: { ticketLine: true },
          },
        },
        orderBy: { issuedAt: "desc" },
      }),
      prisma.costAllocation.findMany({
        where: { ticketLine: { ticketId: id } },
        include: {
          ticketLine: true,
          supplierBillLine: {
            include: { supplierBill: true },
          },
          supplier: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.absorbedCostAllocation.findMany({
        where: { ticketId: id },
        include: {
          supplierBillLine: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.supplier.findMany({ orderBy: { name: "asc" } }),
      prisma.customerPO.findMany({
        where: { ticketId: id },
        include: {
          customer: true,
          site: true,
          lines: true,
          labourDrawdowns: {
            include: { plumberContact: true },
            orderBy: { workDate: "desc" },
          },
          materialsDrawdowns: {
            include: { ticketLine: true },
            orderBy: { drawdownDate: "desc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.evidencePack.findMany({
        where: { ticketId: id },
        include: {
          items: {
            include: {
              evidenceFragment: true,
              event: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.salesInvoice.findMany({
        where: { ticketId: id },
        include: {
          lines: true,
          customer: true,
          poAllocations: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  return (
    <div className="p-8">
      <TicketDetail
        ticket={ticket}
        salesBundles={salesBundles as any}
        quotes={quotes as any}
        customers={customers as any}
        procurementOrders={procurementOrders as any}
        costAllocations={costAllocations as any}
        absorbedCostAllocations={absorbedCostAllocations as any}
        suppliers={allSuppliers as any}
        customerPOs={customerPOs as any}
        evidencePacks={evidencePacks as any}
        salesInvoices={salesInvoices as any}
      />
    </div>
  );
}

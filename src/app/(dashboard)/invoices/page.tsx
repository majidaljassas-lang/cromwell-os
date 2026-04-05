import { prisma } from "@/lib/prisma";
import { InvoicesView } from "@/components/invoices/invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const invoices = await prisma.salesInvoice.findMany({
    include: {
      ticket: true,
      customer: true,
      site: true,
      lines: true,
      poAllocations: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
  });

  // Fetch commercial invoice data with full allocation chain
  const commercialInvoices = await prisma.commercialInvoice.findMany({
    include: {
      lines: {
        include: {
          canonicalProduct: true,
          allocations: {
            include: {
              orderGroup: {
                include: {
                  site: true,
                  orderEvents: {
                    take: 5,
                    orderBy: { timestamp: "asc" },
                    include: { canonicalProduct: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { invoiceDate: "desc" },
  });

  // Build a lookup map: invoiceNumber → commercial invoice data
  const commercialLinkMap: Record<string, typeof commercialInvoices[number]> = {};
  for (const ci of commercialInvoices) {
    commercialLinkMap[ci.invoiceNumber] = ci;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">INVOICES</h1>
      <InvoicesView
        invoices={JSON.parse(JSON.stringify(invoices))}
        customers={JSON.parse(JSON.stringify(customers))}
        commercialLinkMap={JSON.parse(JSON.stringify(commercialLinkMap))}
      />
    </div>
  );
}

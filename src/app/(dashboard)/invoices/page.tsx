import { prisma } from "@/lib/prisma";
import { InvoicesView } from "@/components/invoices/invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const invoices = await prisma.salesInvoice.findMany({
    include: {
      ticket: {
        include: {
          site: true,
        },
      },
      customer: true,
      site: true,
      lines: {
        include: {
          ticketLine: {
            select: {
              id: true,
              expectedCostUnit: true,
              expectedCostTotal: true,
              actualCostTotal: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      poAllocations: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">INVOICES</h1>
      <InvoicesView
        invoices={JSON.parse(JSON.stringify(invoices))}
        customers={JSON.parse(JSON.stringify(customers))}
      />
    </div>
  );
}

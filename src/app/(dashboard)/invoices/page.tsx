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

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
      <InvoicesView invoices={invoices as any} customers={customers as any} />
    </div>
  );
}

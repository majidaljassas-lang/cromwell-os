import { prisma } from "@/lib/prisma";
import { InvoicesView } from "@/components/invoices/invoices-view";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  // Clean cutover: Cromwell OS is the sole system from 2026-04-01.
  // Default operational view = post-cutover. Legacy invoices still in DB but never default.
  const CLEAN_CUTOVER = new Date("2026-04-01");
  const invoices = await prisma.salesInvoice.findMany({
    where: { OR: [{ issuedAt: { gte: CLEAN_CUTOVER } }, { createdAt: { gte: CLEAN_CUTOVER } }] },
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
              // every supplier-bill cost that landed on this ticket line
              costAllocations: {
                select: {
                  id: true,
                  totalCost: true,
                  qtyAllocated: true,
                  unitCost: true,
                  allocationStatus: true,
                  confidenceScore: true,
                  supplierBillLine: {
                    select: {
                      id: true,
                      description: true,
                      supplierBill: {
                        select: {
                          id: true,
                          billNo: true,
                          billDate: true,
                          supplier: { select: { id: true, name: true } },
                        },
                      },
                    },
                  },
                },
              },
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

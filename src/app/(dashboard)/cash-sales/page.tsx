import { prisma } from "@/lib/prisma";
import { CashSalesView } from "@/components/cash-sales/cash-sales-view";

export const dynamic = 'force-dynamic';

export default async function CashSalesPage() {
  const cashSales = await prisma.cashSale.findMany({
    include: {
      ticket: {
        include: {
          payingCustomer: true,
          lines: {
            select: {
              id: true,
              description: true,
              qty: true,
              unit: true,
              expectedCostUnit: true,
              expectedCostTotal: true,
              actualCostTotal: true,
              actualSaleUnit: true,
              actualSaleTotal: true,
              lineType: true,
              supplierName: true,
            },
          },
        },
      },
    },
    orderBy: { receivedAt: "desc" },
  });
  const tickets = await prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">CASH SALES</h1>
      <CashSalesView cashSales={s(cashSales)} tickets={s(tickets)} />
    </div>
  );
}

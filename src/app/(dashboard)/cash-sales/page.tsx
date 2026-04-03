import { prisma } from "@/lib/prisma";
import { CashSalesView } from "@/components/cash-sales/cash-sales-view";

export const dynamic = 'force-dynamic';

export default async function CashSalesPage() {
  const [cashSales, tickets] = await Promise.all([
    prisma.cashSale.findMany({ include: { ticket: { include: { payingCustomer: true } } }, orderBy: { receivedAt: "desc" } }),
    prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Cash Sales</h1>
      <CashSalesView cashSales={JSON.parse(JSON.stringify(cashSales))} tickets={JSON.parse(JSON.stringify(tickets))} />
    </div>
  );
}

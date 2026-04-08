import { prisma } from "@/lib/prisma";
import { ReturnsView } from "@/components/returns/returns-view";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const returns = await prisma.return.findMany({
    include: {
      supplier: true,
      ticket: true,
      lines: {
        include: {
          ticketLine: { select: { id: true, description: true, qty: true, unit: true } },
        },
      },
    },
    orderBy: { returnDate: "desc" },
  });

  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  const tickets = await prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "desc" } });
  const ticketLines = await prisma.ticketLine.findMany({
    select: { id: true, description: true, qty: true, unit: true, expectedCostUnit: true, ticketId: true, supplierName: true },
  });

  // Also get stock items that are returns waiting to go back
  const stockReturns = await prisma.stockItem.findMany({
    where: { sourceType: "RETURN", outcome: "HOLDING", isActive: true },
    orderBy: { createdAt: "desc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <ReturnsView
        returns={s(returns)}
        suppliers={s(suppliers)}
        tickets={s(tickets)}
        ticketLines={s(ticketLines)}
        stockReturns={s(stockReturns)}
      />
    </div>
  );
}

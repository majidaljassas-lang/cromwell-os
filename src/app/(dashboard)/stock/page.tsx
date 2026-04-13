import { prisma } from "@/lib/prisma";
import { StockTable } from "@/components/stock/stock-table";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const items = await prisma.stockItem.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
    include: {
      usages: {
        select: {
          qtyUsed: true,
          totalCost: true,
          ticketLine: {
            select: {
              id: true, description: true, ticketId: true,
              ticket: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });

  const serialized = JSON.parse(JSON.stringify(items.map((item: typeof items[number]) => ({
    ...item,
    qtyOnHand: Number(item.qtyOnHand),
    qtyOriginal: Number(item.qtyOriginal),
    costPerUnit: Number(item.costPerUnit),
    totalUsed: item.usages.reduce((sum: number, u: typeof item.usages[number]) => sum + Number(u.qtyUsed), 0),
    totalValue: Number(item.qtyOnHand) * Number(item.costPerUnit),
  }))));

  return (
    <div className="p-4 space-y-4">
      <StockTable items={serialized} />
    </div>
  );
}

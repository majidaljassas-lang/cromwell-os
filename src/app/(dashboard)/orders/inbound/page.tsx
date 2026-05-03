import { prisma } from "@/lib/prisma";
import { InboundTrackerView } from "@/components/orders/inbound-tracker-view";

export const dynamic = "force-dynamic";

export default async function InboundOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;

  const cutover = new Date("2026-04-01");
  const procurementOrders = await prisma.procurementOrder.findMany({
    where: {
      issuedAt: { gte: cutover },
      status: { notIn: ["CANCELLED"] },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      ticket: {
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          deliveryFailed: true,
          deliveredAt: true,
          site: { select: { siteName: true, postcode: true } },
          payingCustomer: { select: { name: true } },
          logisticsEvents: {
            where: { stopStatus: { not: null } },
            orderBy: { timestamp: "desc" },
            take: 1,
            select: {
              id: true,
              stopStatus: true,
              timestamp: true,
              deliveredAt: true,
            },
          },
        },
      },
      lines: {
        select: { id: true, description: true, qty: true, lineTotal: true },
      },
    },
    orderBy: [{ deliveryDateExpected: "asc" }, { issuedAt: "desc" }],
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return (
    <div className="p-4 space-y-4">
      <InboundTrackerView orders={s(procurementOrders)} filter={filter} />
    </div>
  );
}

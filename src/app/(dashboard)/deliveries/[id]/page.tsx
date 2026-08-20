import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RunDetailView } from "@/components/deliveries/run-detail-view";

export const dynamic = "force-dynamic";

export default async function DeliveryRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const run = await prisma.deliveryRun.findUnique({
    where: { id },
    include: {
      cfSupplier: { select: { id: true, name: true } },
      bills: {
        select: {
          id: true,
          billNo: true,
          billDate: true,
          totalCost: true,
          paymentStatus: true,
        },
        orderBy: { billDate: "desc" },
      },
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          ticket: {
            select: {
              id: true,
              ticketNo: true,
              title: true,
              status: true,
              deliveryBillingMode: true,
              site: { select: { id: true, siteName: true, postcode: true } },
              payingCustomer: { select: { id: true, name: true } },
              lines: {
                select: {
                  id: true,
                  description: true,
                  qty: true,
                  unit: true,
                  lineType: true,
                  actualSaleTotal: true,
                  suggestedSaleUnit: true,
                  deliveryCostShare: true,
                },
                orderBy: { displayOrder: "asc" },
              },
            },
          },
          site: { select: { id: true, siteName: true, postcode: true } },
          supplier: { select: { id: true, name: true } },
          podDocument: { select: { id: true, podType: true, fileName: true } },
        },
      },
    },
  });
  if (!run) notFound();

  // Open tickets that aren't already on this run — for the add-stop picker
  const stopTicketIds = run.stops.map((s) => s.ticketId);
  const openTickets = await prisma.ticket.findMany({
    where: {
      status: { notIn: ["CLOSED", "LOCKED"] },
      id: { notIn: stopTicketIds.length ? stopTicketIds : undefined },
      createdAt: { gte: new Date("2026-04-01") },
    },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      site: { select: { siteName: true, postcode: true } },
      payingCustomer: { select: { name: true } },
    },
    orderBy: { ticketNo: "desc" },
    take: 200,
  });

  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const cfSuppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { deliveryRunsAsCarrier: { some: {} } },
        { name: { contains: "cromwell freight", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Unmatched CF supplier bills available to allocate (only when run is CF)
  let candidateBills: { id: string; billNo: string; billDate: Date; totalCost: unknown }[] = [];
  if (run.driverSource === "CROMWELL_FREIGHT" && run.cfSupplierId) {
    candidateBills = await prisma.supplierBill.findMany({
      where: {
        supplierId: run.cfSupplierId,
        deliveryRunId: null,
      },
      select: { id: true, billNo: true, billDate: true, totalCost: true },
      orderBy: { billDate: "desc" },
      take: 50,
    });
  }

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return (
    <div className="p-4 space-y-4">
      <RunDetailView
        run={s(run)}
        openTickets={s(openTickets)}
        suppliers={suppliers}
        cfSuppliers={cfSuppliers}
        candidateBills={s(candidateBills)}
      />
    </div>
  );
}

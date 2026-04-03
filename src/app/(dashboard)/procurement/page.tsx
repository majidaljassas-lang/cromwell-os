import { prisma } from "@/lib/prisma";
import { ProcurementView } from "@/components/procurement/procurement-view";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  const [
    supplierBills,
    unresolvedAllocations,
    absorbedCosts,
    returns,
    stockExcess,
    reallocations,
    suppliers,
    tickets,
  ] = await Promise.all([
    prisma.supplierBill.findMany({
      include: {
        supplier: true,
        lines: true,
        _count: { select: { lines: true } },
      },
      orderBy: { billDate: "desc" },
    }),
    prisma.costAllocation.findMany({
      where: { allocationStatus: { not: "MATCHED" } },
      include: {
        ticketLine: true,
        supplierBillLine: {
          include: { supplierBill: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.absorbedCostAllocation.findMany({
      include: {
        supplierBillLine: true,
        ticket: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.return.findMany({
      include: {
        supplier: true,
        ticket: true,
        lines: true,
      },
      orderBy: { returnDate: "desc" },
    }),
    prisma.stockExcessRecord.findMany({
      where: { status: { not: "CLOSED" } },
      include: {
        supplierBillLine: true,
        ticketLine: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.reallocationRecord.findMany({
      include: {
        fromTicketLine: { include: { ticket: true } },
        toTicketLine: { include: { ticket: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.ticket.findMany({
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="p-8">
      <ProcurementView
        supplierBills={supplierBills as any}
        unresolvedAllocations={unresolvedAllocations as any}
        absorbedCosts={absorbedCosts as any}
        returns={returns as any}
        stockExcess={stockExcess as any}
        reallocations={reallocations as any}
        suppliers={suppliers as any}
        tickets={tickets as any}
      />
    </div>
  );
}

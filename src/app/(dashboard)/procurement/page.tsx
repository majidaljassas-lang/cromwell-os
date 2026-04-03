import { prisma } from "@/lib/prisma";
import { ProcurementView } from "@/components/procurement/procurement-view";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  // Sequential queries to avoid connection exhaustion on Prisma dev server
  const supplierBills = await prisma.supplierBill.findMany({
    include: { supplier: true, lines: true, _count: { select: { lines: true } } },
    orderBy: { billDate: "desc" },
  });
  const unresolvedAllocations = await prisma.costAllocation.findMany({
    where: { allocationStatus: { not: "MATCHED" } },
    include: { ticketLine: true, supplierBillLine: { include: { supplierBill: true } } },
    orderBy: { createdAt: "desc" },
  });
  const absorbedCosts = await prisma.absorbedCostAllocation.findMany({
    include: { supplierBillLine: true, ticket: true },
    orderBy: { createdAt: "desc" },
  });
  const returns = await prisma.return.findMany({
    include: { supplier: true, ticket: true, lines: true },
    orderBy: { returnDate: "desc" },
  });
  const stockExcess = await prisma.stockExcessRecord.findMany({
    where: { status: { not: "CLOSED" } },
    include: { supplierBillLine: true, ticketLine: true },
    orderBy: { createdAt: "desc" },
  });
  const reallocations = await prisma.reallocationRecord.findMany({
    include: { fromTicketLine: { include: { ticket: true } }, toTicketLine: { include: { ticket: true } } },
    orderBy: { createdAt: "desc" },
  });
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
  const tickets = await prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "desc" } });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <ProcurementView
        supplierBills={s(supplierBills)}
        unresolvedAllocations={s(unresolvedAllocations)}
        absorbedCosts={s(absorbedCosts)}
        returns={s(returns)}
        stockExcess={s(stockExcess)}
        reallocations={s(reallocations)}
        suppliers={s(suppliers)}
        tickets={s(tickets)}
      />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { ProcurementView } from "@/components/procurement/procurement-view";

export const dynamic = "force-dynamic";

export default async function ProcurementPage() {
  // Sequential queries to avoid connection exhaustion on Prisma dev server
  // Clean cutover: Cromwell OS is the sole system from 2026-04-01.
  // All operational views default to >= cutover. Legacy data stays in DB but never default.
  const CLEAN_CUTOVER = new Date("2026-04-01");
  const supplierBills = await prisma.supplierBill.findMany({
    where: { billDate: { gte: CLEAN_CUTOVER } },
    include: {
      supplier: true,
      duplicateOf: { select: { id: true, billNo: true } },
      lines: {
        include: {
          site: { select: { id: true, siteName: true } },
          customer: { select: { id: true, name: true } },
          // Pull the matched ticket AND every invoice line on that ticket so the renderer can
          // find the matching sale even when no CostAllocation was written (SUGGESTED state).
          ticket: {
            select: {
              id: true,
              ticketNo: true,
              title: true,
              invoices: {
                select: {
                  id: true,
                  invoiceNo: true,
                  status: true,
                  lines: {
                    select: {
                      id: true,
                      ticketLineId: true,
                      description: true,
                      qty: true,
                      unitPrice: true,
                      lineTotal: true,
                    },
                  },
                },
              },
            },
          },
          // Multi-allocation engine output — one bill line → many destinations
          billLineAllocations: {
            include: {
              ticketLine: { select: { id: true, description: true, ticket: { select: { id: true, ticketNo: true, title: true } } } },
              site:       { select: { id: true, siteName: true } },
              customer:   { select: { id: true, name: true } },
            },
          },
          // Per-axis confidence breakdown from the multi-signal match engine
          billLineMatches: {
            orderBy: { overallConfidence: "desc" },
            take: 5,
            select: {
              id: true,
              candidateType: true,
              candidateId: true,
              supplierConfidence: true,
              productConfidence: true,
              ticketConfidence: true,
              siteConfidence: true,
              entityConfidence: true,
              overallConfidence: true,
              action: true,
              reasons: true,
            },
          },
          // Cost allocations remain the precise path when present
          costAllocations: {
            include: {
              ticketLine: {
                select: {
                  id: true,
                  description: true,
                  invoiceLines: {
                    select: {
                      id: true,
                      qty: true,
                      unitPrice: true,
                      lineTotal: true,
                      salesInvoice: {
                        select: { id: true, invoiceNo: true, status: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      _count: { select: { lines: true } },
    },
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

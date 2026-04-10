import { prisma } from "@/lib/prisma";
import { ReportsView } from "@/components/reports/reports-view";

export const dynamic = "force-dynamic";

type DecimalLike = { toString(): string } | string | number | null;
type LineAmounts = { actualSaleTotal: DecimalLike; actualCostTotal: DecimalLike };

export default async function ReportsPage() {
  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  // ─── Site Profitability ─────────────────────────────────────────────
  const [allSites, siteAbsorbed] = await Promise.all([
    prisma.site.findMany({
      include: { ticketLines: { select: { actualSaleTotal: true, actualCostTotal: true } } },
    }),
    prisma.absorbedCostAllocation.findMany({
      include: { ticket: { select: { siteId: true } } },
    }),
  ]);

  const absorbedBySite: Record<string, number> = {};
  for (const alloc of siteAbsorbed) {
    const sid = alloc.ticket.siteId;
    if (sid) absorbedBySite[sid] = (absorbedBySite[sid] ?? 0) + Number(alloc.amount);
  }

  const siteProfitability = allSites
    .map((site: typeof allSites[number]) => {
      const totalRevenue = site.ticketLines.reduce((sum: number, l: LineAmounts) => sum + Number(l.actualSaleTotal ?? 0), 0);
      const totalCost = site.ticketLines.reduce((sum: number, l: LineAmounts) => sum + Number(l.actualCostTotal ?? 0), 0);
      const absorbed = absorbedBySite[site.id] ?? 0;
      const profit = totalRevenue - totalCost - absorbed;
      const marginPct = totalRevenue > 0 ? Number(((profit / totalRevenue) * 100).toFixed(2)) : 0;
      return { siteId: site.id, siteName: site.siteName, totalRevenue, totalCost, absorbedCosts: absorbed, profit, marginPct };
    })
    .sort((a: { profit: number }, b: { profit: number }) => b.profit - a.profit);

  // ─── Customer Profitability ─────────────────────────────────────────
  const [allCustomers, custAbsorbed] = await Promise.all([
    prisma.customer.findMany({
      include: {
        ticketsAsPayer: {
          include: { lines: { select: { actualSaleTotal: true, actualCostTotal: true } } },
        },
      },
    }),
    prisma.absorbedCostAllocation.findMany({
      include: { ticket: { select: { payingCustomerId: true } } },
    }),
  ]);

  const absorbedByCustomer: Record<string, number> = {};
  for (const alloc of custAbsorbed) {
    const cid = alloc.ticket.payingCustomerId;
    absorbedByCustomer[cid] = (absorbedByCustomer[cid] ?? 0) + Number(alloc.amount);
  }

  const customerProfitability = allCustomers
    .map((customer: typeof allCustomers[number]) => {
      const allLines = customer.ticketsAsPayer.flatMap((t: typeof allCustomers[number]["ticketsAsPayer"][number]) => t.lines);
      const totalRevenue = allLines.reduce((sum: number, l: LineAmounts) => sum + Number(l.actualSaleTotal ?? 0), 0);
      const totalCost = allLines.reduce((sum: number, l: LineAmounts) => sum + Number(l.actualCostTotal ?? 0), 0);
      const absorbed = absorbedByCustomer[customer.id] ?? 0;
      const profit = totalRevenue - totalCost - absorbed;
      const marginPct = totalRevenue > 0 ? Number(((profit / totalRevenue) * 100).toFixed(2)) : 0;
      return { customerId: customer.id, customerName: customer.name, totalRevenue, totalCost, absorbedCosts: absorbed, profit, marginPct };
    })
    .sort((a: { profit: number }, b: { profit: number }) => b.profit - a.profit);

  // ─── PO Utilisation ─────────────────────────────────────────────────
  const customerPOs = await prisma.customerPO.findMany({
    include: {
      customer: { select: { name: true } },
      ticket: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const poUtilisation = customerPOs.map((po: typeof customerPOs[number]) => {
    const limit = po.poLimitValue ?? po.totalValue;
    const consumed = po.poConsumedValue;
    const remaining = po.poRemainingValue;
    const profit = po.profitToDate;
    const utilisationPct =
      limit && Number(limit) > 0
        ? Number(((Number(consumed) / Number(limit)) * 100).toFixed(2))
        : 0;
    return {
      id: po.id,
      poNo: po.poNo,
      poType: po.poType,
      customerName: po.customer.name,
      ticketTitle: po.ticket?.title ?? null,
      limit,
      consumed,
      remaining,
      profit,
      utilisationPct,
      status: po.status,
    };
  });

  // ─── Recovery Ageing ────────────────────────────────────────────────
  const recoveryCases = await prisma.recoveryCase.findMany({
    where: { recoveryStatus: { not: "CLOSED" } },
    include: {
      ticket: {
        select: {
          title: true,
          payingCustomer: { select: { name: true } },
        },
      },
    },
    orderBy: { openedAt: "asc" },
  });

  const now = new Date();
  const recoveryAgeing = recoveryCases.map((rc: typeof recoveryCases[number]) => {
    const daysOpen = rc.openedAt
      ? Math.floor((now.getTime() - new Date(rc.openedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const daysInCurrentStage = rc.currentStageStartedAt
      ? Math.floor((now.getTime() - new Date(rc.currentStageStartedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;
    return {
      id: rc.id,
      ticketId: rc.ticketId,
      ticketTitle: rc.ticket.title,
      customerName: rc.ticket.payingCustomer.name,
      recoveryStatus: rc.recoveryStatus,
      stuckValue: rc.stuckValue,
      daysOpen,
      daysInCurrentStage,
      nextAction: rc.nextAction,
    };
  });

  // ─── Absorbed Costs ─────────────────────────────────────────────────
  const allAllocations = await prisma.absorbedCostAllocation.findMany({
    include: {
      ticket: { select: { id: true, title: true } },
      supplierBillLine: { select: { description: true, lineTotal: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const byTicket: Record<string, { ticketId: string; ticketTitle: string; totalAbsorbed: number; lineItems: typeof allAllocations }> = {};
  for (const alloc of allAllocations) {
    const key = alloc.ticketId;
    if (!byTicket[key]) {
      byTicket[key] = { ticketId: alloc.ticketId, ticketTitle: alloc.ticket.title, totalAbsorbed: 0, lineItems: [] };
    }
    byTicket[key].totalAbsorbed += Number(alloc.amount);
    byTicket[key].lineItems.push(alloc);
  }
  const absorbedCosts = Object.values(byTicket).sort((a, b) => b.totalAbsorbed - a.totalAbsorbed);

  // ─── Unallocated Costs ──────────────────────────────────────────────
  const unallocatedCosts = await prisma.supplierBillLine.findMany({
    where: { allocationStatus: "UNALLOCATED" },
    include: {
      supplierBill: {
        include: { supplier: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">REPORTS</h1>
      <ReportsView
        siteProfitability={s(siteProfitability)}
        customerProfitability={s(customerProfitability)}
        poUtilisation={s(poUtilisation)}
        recoveryAgeing={s(recoveryAgeing)}
        absorbedCosts={s(absorbedCosts)}
        unallocatedCosts={s(unallocatedCosts)}
      />
    </div>
  );
}

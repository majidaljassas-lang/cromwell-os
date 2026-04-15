import { prisma } from "@/lib/prisma";
import { TicketsTable } from "@/components/tickets/tickets-table";

export const dynamic = 'force-dynamic';

export default async function TicketsPage() {
  // Clean cutover: Cromwell OS is the sole system from 2026-04-01.
  const CLEAN_CUTOVER = new Date("2026-04-01");
  const tickets = await prisma.ticket.findMany({
    where: { createdAt: { gte: CLEAN_CUTOVER } },
    include: {
      payingCustomer: true,
      site: true,
      _count: {
        select: { lines: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const sites = await prisma.site.findMany({
    orderBy: { siteName: "asc" },
    select: { id: true, siteName: true },
  });

  const commercialLinks = await prisma.siteCommercialLink.findMany({
    select: { id: true, customerId: true, siteId: true, site: { select: { id: true, siteName: true } } },
    where: { isActive: true },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <TicketsTable tickets={tickets} customers={customers} sites={sites} commercialLinks={s(commercialLinks)} />
    </div>
  );
}

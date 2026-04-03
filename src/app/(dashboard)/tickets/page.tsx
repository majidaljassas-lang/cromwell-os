import { prisma } from "@/lib/prisma";
import { TicketsTable } from "@/components/tickets/tickets-table";

export const dynamic = 'force-dynamic';

export default async function TicketsPage() {
  const tickets = await prisma.ticket.findMany({
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

  return (
    <div className="p-8">
      <TicketsTable tickets={tickets} customers={customers} sites={sites} />
    </div>
  );
}

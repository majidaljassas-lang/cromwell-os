import { prisma } from "@/lib/prisma";
import { InboxView } from "@/components/inbox/inbox-view";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true, isBillingEntity: true },
    orderBy: { name: "asc" },
  });
  const sites = await prisma.site.findMany({
    select: { id: true, siteName: true },
    orderBy: { siteName: "asc" },
  });
  const tickets = await prisma.ticket.findMany({
    where: { status: { notIn: ["CLOSED", "INVOICED"] } },
    select: { id: true, ticketNo: true, title: true, payingCustomerId: true, siteId: true },
    orderBy: { createdAt: "desc" },
  });
  const commercialLinks = await prisma.siteCommercialLink.findMany({
    where: { isActive: true },
    select: {
      id: true,
      customerId: true,
      siteId: true,
      site: { select: { id: true, siteName: true } },
    },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <InboxView
        customers={s(customers)}
        sites={s(sites)}
        tickets={s(tickets)}
        commercialLinks={s(commercialLinks)}
      />
    </div>
  );
}

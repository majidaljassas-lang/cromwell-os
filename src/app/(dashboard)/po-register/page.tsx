import { prisma } from "@/lib/prisma";
import { PORegisterView } from "@/components/po-register/po-register-view";

export const dynamic = "force-dynamic";

export default async function PORegisterPage() {
  const customerPOs = await prisma.customerPO.findMany({
    include: {
      customer: true, site: true,
      ticket: { include: { site: true, quotes: { select: { id: true, quoteNo: true, status: true }, orderBy: { createdAt: "desc" as const } } } },
      lines: true,
      labourDrawdowns: { include: { ticket: true, site: true, plumberContact: true }, orderBy: { workDate: "desc" as const } },
      materialsDrawdowns: { include: { ticket: true, ticketLine: true }, orderBy: { drawdownDate: "desc" as const } },
      cashPayments: { orderBy: { paymentDate: "desc" as const } },
      _count: { select: { labourDrawdowns: true, materialsDrawdowns: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const sites = await prisma.site.findMany({ orderBy: { siteName: "asc" } });
  const tickets = await prisma.ticket.findMany({ select: { id: true, ticketNo: true, title: true, payingCustomerId: true, siteId: true }, orderBy: { createdAt: "desc" } });
  const contacts = await prisma.contact.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } });
  const commercialLinks = await prisma.siteCommercialLink.findMany({
    select: { id: true, customerId: true, siteId: true, site: { select: { id: true, siteName: true } } },
    where: { isActive: true },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <PORegisterView
        customerPOs={s(customerPOs)}
        customers={s(customers)}
        sites={s(sites)}
        tickets={s(tickets)}
        contacts={s(contacts)}
        commercialLinks={s(commercialLinks)}
      />
    </div>
  );
}

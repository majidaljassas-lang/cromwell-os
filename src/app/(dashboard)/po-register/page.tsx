import { prisma } from "@/lib/prisma";
import { PORegisterView } from "@/components/po-register/po-register-view";

export const dynamic = "force-dynamic";

export default async function PORegisterPage() {
  const customerPOs = await prisma.customerPO.findMany({
    include: {
      customer: true, site: true, ticket: true, lines: true,
      labourDrawdowns: { include: { ticket: true, site: true, plumberContact: true }, orderBy: { workDate: "desc" as const } },
      materialsDrawdowns: { include: { ticket: true, ticketLine: true }, orderBy: { drawdownDate: "desc" as const } },
      _count: { select: { labourDrawdowns: true, materialsDrawdowns: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
  const sites = await prisma.site.findMany({ orderBy: { siteName: "asc" } });
  const tickets = await prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "desc" } });
  const contacts = await prisma.contact.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <PORegisterView
        customerPOs={s(customerPOs)}
        customers={s(customers)}
        sites={s(sites)}
        tickets={s(tickets)}
        contacts={s(contacts)}
      />
    </div>
  );
}

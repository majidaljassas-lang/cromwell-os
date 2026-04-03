import { prisma } from "@/lib/prisma";
import { PORegisterView } from "@/components/po-register/po-register-view";

export const dynamic = "force-dynamic";

export default async function PORegisterPage() {
  const [customerPOs, customers, sites, tickets, contacts] = await Promise.all([
    prisma.customerPO.findMany({
      include: {
        customer: true,
        site: true,
        ticket: true,
        lines: true,
        labourDrawdowns: {
          include: {
            ticket: true,
            site: true,
            plumberContact: true,
          },
          orderBy: { workDate: "desc" as const },
        },
        materialsDrawdowns: {
          include: {
            ticket: true,
            ticketLine: true,
          },
          orderBy: { drawdownDate: "desc" as const },
        },
        _count: {
          select: {
            labourDrawdowns: true,
            materialsDrawdowns: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.customer.findMany({ orderBy: { name: "asc" } }),
    prisma.site.findMany({ orderBy: { siteName: "asc" } }),
    prisma.ticket.findMany({
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contact.findMany({
      where: { isActive: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  return (
    <div className="p-8">
      <PORegisterView
        customerPOs={customerPOs as any}
        customers={customers as any}
        sites={sites as any}
        tickets={tickets as any}
        contacts={contacts as any}
      />
    </div>
  );
}

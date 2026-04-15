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

  // Enrich POs with auto-discovered linked invoices (reverse link from SalesInvoice.poNo → CustomerPO.poNo)
  const allInvoices = await prisma.salesInvoice.findMany({
    where: { poNo: { not: null } },
    select: { id: true, invoiceNo: true, poNo: true, customerId: true, status: true, totalSell: true },
  });

  const customerPOsEnriched = customerPOs.map(po => {
    if (po.invoiceNo) return po; // already has invoice ref, keep it
    // Find invoices matching by poNo + customer family
    const matched = allInvoices.filter(inv => inv.poNo === po.poNo && inv.customerId === po.customerId);
    if (matched.length > 0) {
      return { ...po, invoiceNo: matched.map(i => i.invoiceNo).filter(Boolean).join(", "), linkedInvoices: matched };
    }
    return po;
  });
  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, parentCustomerEntityId: true,
      parentEntity: { select: { id: true, name: true } },
    },
  });
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
        customerPOs={s(customerPOsEnriched)}
        customers={s(customers)}
        sites={s(sites)}
        tickets={s(tickets)}
        contacts={s(contacts)}
        commercialLinks={s(commercialLinks)}
      />
    </div>
  );
}

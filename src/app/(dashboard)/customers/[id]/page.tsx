import { prisma } from "@/lib/prisma";
import { CustomerDetail } from "@/components/customers/customer-detail";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      siteCommercialLinks: {
        include: { site: { select: { id: true, siteName: true, siteCode: true, city: true, postcode: true, aliases: true } } },
        where: { isActive: true },
      },
      siteContactLinks: {
        include: { contact: { select: { id: true, fullName: true, phone: true, email: true } } },
        where: { isActive: true },
      },
      ticketsAsPayer: {
        select: { id: true, title: true, status: true, ticketMode: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      customerPOs: {
        select: { id: true, poNo: true, poType: true, status: true, totalValue: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      parentEntity: { select: { id: true, name: true } },
      subsidiaries: { select: { id: true, name: true, legalName: true, isBillingEntity: true } },
      customerAliases: {
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!customer) {
    return <div className="p-4 text-[#FF3333]">Customer not found</div>;
  }

  const allSites = await prisma.site.findMany({
    select: { id: true, siteName: true },
    orderBy: { siteName: "asc" },
  });

  const allCustomers = await prisma.customer.findMany({
    where: { id: { not: id } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <CustomerDetail customer={s(customer)} allSites={s(allSites)} allCustomers={s(allCustomers)} />
    </div>
  );
}

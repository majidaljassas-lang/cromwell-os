import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { SiteDetail } from "@/components/sites/site-detail";

export default async function SiteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      siteCommercialLinks: {
        include: {
          customer: true,
        },
      },
      siteContactLinks: {
        include: {
          contact: true,
          customer: true,
        },
      },
      tickets: {
        include: {
          payingCustomer: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!site) {
    notFound();
  }

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // All supplier bill lines that landed on this site (via auto-link or manual)
  const supplierBillLines = await prisma.supplierBillLine.findMany({
    where: { siteId: id },
    include: {
      supplierBill: { include: { supplier: { select: { id: true, name: true } } } },
      ticket:   { select: { id: true, ticketNo: true, title: true } },
      customer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return (
    <div className="p-8">
      <SiteDetail site={s(site)} customers={s(customers)} supplierBillLines={s(supplierBillLines)} />
    </div>
  );
}

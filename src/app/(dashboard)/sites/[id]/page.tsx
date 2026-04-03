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

  return (
    <div className="p-8">
      <SiteDetail site={site} customers={customers} />
    </div>
  );
}

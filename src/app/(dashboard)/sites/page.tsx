import { prisma } from "@/lib/prisma";
import { SitesTable } from "@/components/sites/sites-table";

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const sites = await prisma.site.findMany({
    include: {
      siteCommercialLinks: {
        include: { customer: { select: { id: true, name: true } } },
        where: { isActive: true },
      },
    },
    orderBy: { siteName: "asc" },
  });

  const customers = await prisma.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <SitesTable sites={s(sites)} customers={customers} />
    </div>
  );
}

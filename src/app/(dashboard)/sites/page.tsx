import { prisma } from "@/lib/prisma";
import { SitesTable } from "@/components/sites/sites-table";

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const sites = await prisma.site.findMany({
    include: {
      siteCommercialLinks: true,
    },
    orderBy: { siteName: "asc" },
  });

  return (
    <div className="p-4 space-y-4">
      <SitesTable sites={sites} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { SitePacksView } from "@/components/site-packs/site-packs-view";

export const dynamic = "force-dynamic";

export default async function SitePacksPage() {
  const [sitePacks, sites] = await Promise.all([
    prisma.sitePack.findMany({
      include: {
        site: true,
        items: {
          include: {
            ticket: true,
            salesInvoice: true,
            evidencePack: true,
          },
        },
      },
      orderBy: { packDate: "desc" },
    }),
    prisma.site.findMany({
      select: { id: true, siteName: true },
      orderBy: { siteName: "asc" },
    }),
  ]);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Site Packs</h1>
      <SitePacksView sitePacks={sitePacks as any} sites={sites} />
    </div>
  );
}

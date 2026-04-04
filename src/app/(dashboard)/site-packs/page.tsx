import { prisma } from "@/lib/prisma";
import { SitePacksView } from "@/components/site-packs/site-packs-view";

export const dynamic = "force-dynamic";

export default async function SitePacksPage() {
  const sitePacks = await prisma.sitePack.findMany({
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
  });
  const sites = await prisma.site.findMany({
    select: { id: true, siteName: true },
    orderBy: { siteName: "asc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">SITE PACKS</h1>
      <SitePacksView sitePacks={s(sitePacks) as any} sites={s(sites)} />
    </div>
  );
}

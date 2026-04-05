import { prisma } from "@/lib/prisma";
import { CommercialView } from "@/components/commercial/commercial-view";

export const dynamic = "force-dynamic";

export default async function CommercialPage() {
  // Sequential queries — no Promise.all (connection exhaustion prevention)
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    orderBy: { siteName: "asc" },
  });

  const reviewQueue = await prisma.reviewQueueItem.findMany({
    where: { status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] } },
  });

  // Group review queue by type
  const reviewSummary: Record<string, number> = {};
  for (const item of reviewQueue) {
    reviewSummary[item.queueType] = (reviewSummary[item.queueType] || 0) + 1;
  }

  // Build site → backlog case ID map for media scanning
  const backlogCases = await prisma.backlogCase.findMany({
    where: { siteId: { not: null } },
    select: { id: true, siteId: true },
  });

  const siteCaseMap: Record<string, string> = {};
  for (const bc of backlogCases) {
    if (bc.siteId) siteCaseMap[bc.siteId] = bc.id;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        COMMERCIAL RECONCILIATION
      </h1>
      <CommercialView
        sites={JSON.parse(JSON.stringify(sites))}
        reviewSummary={reviewSummary}
        siteCaseMap={siteCaseMap}
      />
    </div>
  );
}

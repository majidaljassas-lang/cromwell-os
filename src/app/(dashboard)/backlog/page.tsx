import { prisma } from "@/lib/prisma";
import { BacklogCaseList } from "@/components/backlog/case-list";

export const dynamic = "force-dynamic";

export default async function BacklogPage() {
  const cases = await prisma.backlogCase.findMany({
    include: {
      sourceGroups: {
        include: {
          sources: { select: { id: true, messageCount: true, label: true, sourceType: true, dateFrom: true, dateTo: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        BACKLOG RECONSTRUCTION
      </h1>
      <BacklogCaseList cases={s(cases)} />
    </div>
  );
}

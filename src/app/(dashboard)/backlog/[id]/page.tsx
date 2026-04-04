import { prisma } from "@/lib/prisma";
import { BacklogCaseView } from "@/components/backlog/case-view";

export const dynamic = "force-dynamic";

export default async function BacklogCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const backlogCase = await prisma.backlogCase.findUnique({
    where: { id },
    include: {
      sourceGroups: {
        include: {
          sources: { include: { _count: { select: { messages: true } } } },
        },
      },
    },
  });

  if (!backlogCase) {
    return <div className="p-4 text-[#FF3333]">Case not found</div>;
  }

  // Fetch timeline stats
  const sourceIds = backlogCase.sourceGroups.flatMap((g) => g.sources.map((s) => s.id));
  let stats = { messageCount: 0, participants: [] as string[], attachmentCount: 0 };

  if (sourceIds.length > 0) {
    const messages = await prisma.backlogMessage.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { sender: true, hasAttachment: true },
    });
    stats = {
      messageCount: messages.length,
      participants: [...new Set(messages.map((m) => m.sender))],
      attachmentCount: messages.filter((m) => m.hasAttachment).length,
    };
  }

  // Fetch first batch of timeline messages
  const timelineMessages = sourceIds.length > 0 ? await prisma.backlogMessage.findMany({
    where: { sourceId: { in: sourceIds } },
    orderBy: { parsedTimestamp: "asc" },
    take: 200,
  }) : [];

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <BacklogCaseView
        backlogCase={s(backlogCase)}
        stats={s(stats)}
        initialMessages={s(timelineMessages)}
        sourceMap={Object.fromEntries(
          backlogCase.sourceGroups.flatMap((g) => g.sources.map((src) => [src.id, { label: src.label, sourceType: src.sourceType }]))
        )}
      />
    </div>
  );
}

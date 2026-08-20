import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyComposer } from "@/components/inbox/reply-composer";

export const dynamic = "force-dynamic";

export default async function ReplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { occurredAt: "desc" },
        take: 5,
      },
    },
  });
  if (!thread) notFound();

  // Pull the reaction Task's draftBody if present (AI-suggested reply text).
  const reactionTask = thread.reactionTaskId
    ? await prisma.task.findUnique({
        where: { id: thread.reactionTaskId },
        select: { id: true, draftBody: true, taskType: true, status: true },
      })
    : null;

  const lastMessage = thread.messages[0] ?? null;
  const replyTo = lastMessage?.sender ?? thread.participants[0] ?? "";
  const subjectPrefix = (thread.subject ?? "").startsWith("Re:") ? "" : "Re: ";

  const TEMPLATES: Record<string, string> = {
    availability:
      "Hi,\n\nThanks for the enquiry. I can confirm the following stock / lead time:\n\n  • [item] — [qty in stock] / [lead time]\n\nLet me know if you'd like to proceed.\n\nKind regards,",
    delivery:
      "Hi,\n\nQuick update on your order: [delivery status / ETA].\n\nLet me know if anything else is needed.\n\nKind regards,",
  };
  const initialBody =
    reactionTask?.draftBody ??
    (sp.template && TEMPLATES[sp.template]) ??
    "";

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <div>
          <Link
            href="/inbox"
            className="text-[10px] tracking-widest text-[#888888] bb-mono hover:text-[#FF6600]"
          >
            ← INBOX
          </Link>
          <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono mt-1">
            REPLY
          </h1>
        </div>
        {reactionTask && (
          <span className="text-[10px] uppercase tracking-widest text-[#FFCC00] bb-mono">
            Task: {reactionTask.taskType} · {reactionTask.status}
          </span>
        )}
      </div>

      <div className="border border-[#2A2A2A] bg-[#0F0F0F] p-3 space-y-1 bb-mono text-[11px]">
        <div className="text-[#888]">
          <span className="text-[#666]">Channel:</span> {thread.channel}
        </div>
        <div className="text-[#888]">
          <span className="text-[#666]">From:</span> {replyTo || "(unknown)"}
        </div>
        <div className="text-[#CCCCCC]">
          <span className="text-[#666]">Subject:</span> {thread.subject ?? "(no subject)"}
        </div>
      </div>

      {lastMessage && (
        <div className="border border-[#222] bg-[#0A0A0A] p-3 text-[11px] text-[#888] bb-mono whitespace-pre-wrap">
          <div className="text-[10px] text-[#666] mb-1">
            Last message · {new Date(lastMessage.occurredAt).toLocaleString("en-GB")}
          </div>
          {lastMessage.snippet ?? "(no preview)"}
        </div>
      )}

      <ReplyComposer
        threadId={thread.id}
        channel={thread.channel}
        replyTo={replyTo}
        subject={`${subjectPrefix}${thread.subject ?? ""}`}
        initialBody={initialBody}
        reactionTaskId={reactionTask?.id ?? null}
      />
    </div>
  );
}

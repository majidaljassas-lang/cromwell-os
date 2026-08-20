import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autoLinkThread } from "@/lib/inbox/thread-builder";
import { scoreOpenTicketsForText } from "@/lib/ingestion/link-resolver";

/**
 * Re-evaluate a single thread's auto-link. Useful after a scorer change to
 * verify a previously mis-linked thread now resolves correctly. Honors the
 * downgrade path in autoLinkThread, so a no-longer-supported MEDIUM link will
 * clear.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const before = await prisma.inboxThread.findUnique({
    where: { id },
    select: {
      channel: true,
      conversationKey: true,
      linkedTicketId: true,
      linkConfidence: true,
      linkSource: true,
      messages: { orderBy: { occurredAt: "desc" }, take: 1, select: { sender: true } },
    },
  });
  if (!before) return NextResponse.json({ error: "thread not found" }, { status: 404 });

  const sender = before.messages[0]?.sender ?? null;

  // Build the scoring input the same way thread-builder does so we can
  // surface per-ticket score + reasons.
  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    select: { subject: true, lastSnippet: true, latestAt: true },
  });
  const messages = await prisma.inboxThreadMessage.findMany({
    where: { threadId: id },
    orderBy: { occurredAt: "desc" },
    take: 20,
    select: { snippet: true },
  });
  const rawText = [thread?.lastSnippet ?? "", ...messages.map((m) => m.snippet ?? "")]
    .filter(Boolean)
    .join("\n");

  const senderEmail = sender && sender.includes("@") && !sender.includes("@c.us") && !sender.includes("@g.us") ? sender : null;
  const senderPhone = sender && (sender.includes("@c.us") || sender.includes("@s.whatsapp.net")) ? sender : null;

  const candidates = await scoreOpenTicketsForText({
    eventType: "THREAD_SCORING",
    sourceType: before.channel === "EMAIL" ? "OUTLOOK" : "WHATSAPP",
    sender,
    senderPhone,
    senderEmail,
    receivedAt: thread?.latestAt ?? new Date(),
    rawText,
    subject: thread?.subject ?? null,
  });

  await autoLinkThread(id, before.channel as never, before.conversationKey, sender);

  const after = await prisma.inboxThread.findUnique({
    where: { id },
    select: { linkedTicketId: true, linkConfidence: true, linkSource: true, status: true },
  });

  // Hydrate top candidates with ticketNo/title + the ref strings the scorer
  // would have used in correlation for diagnostics.
  const topIds = candidates.slice(0, 5).map((c) => c.entityId);
  const tickets = topIds.length
    ? await prisma.ticket.findMany({
        where: { id: { in: topIds } },
        select: {
          id: true,
          ticketNo: true,
          title: true,
          customerPOs: { select: { poNo: true } },
          quotes: { select: { quoteNo: true } },
          invoices: { select: { invoiceNo: true } },
        },
      })
    : [];
  const byId = new Map(tickets.map((t) => [t.id, t]));

  return NextResponse.json({
    threadId: id,
    before: {
      linkedTicketId: before.linkedTicketId,
      linkConfidence: before.linkConfidence,
      linkSource: before.linkSource,
    },
    after,
    rawTextSnippet: rawText.slice(0, 600),
    subject: thread?.subject,
    sender,
    topCandidates: candidates.slice(0, 5).map((c) => {
      const t = byId.get(c.entityId);
      return {
        ticketNo: t?.ticketNo ?? null,
        title: t?.title ?? null,
        score: c.score,
        reasons: c.reasons,
        ticketRefs: t
          ? {
              ticketNo: t.ticketNo,
              poNos: (t.customerPOs ?? []).map((p) => p.poNo),
              quoteNos: (t.quotes ?? []).map((q) => q.quoteNo),
              invoiceNos: (t.invoices ?? []).map((i) => i.invoiceNo),
            }
          : null,
      };
    }),
  });
}

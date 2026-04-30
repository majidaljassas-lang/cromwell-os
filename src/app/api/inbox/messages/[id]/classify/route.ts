/**
 * POST /api/inbox/messages/:id/classify
 *   Body: {
 *     tagIds: string[];
 *     ticketIds?: string[];
 *     customerId?: string;   // override / supply when no ticket fits
 *     siteId?: string;
 *     notes?: string;
 *   }
 *
 *   Records manual classification(s) for an inbox message and fires the
 *   routing handler for each tag. The bill parser, procurement, etc. still
 *   do the AI work — the user just makes the decision.
 *
 *   :id refers to the InboxThreadMessage id.
 */
import { prisma } from "@/lib/prisma";
import { runTagHandler } from "@/lib/inbox/manual-classification";

type Body = {
  tagIds: string[];
  ticketIds?: string[];
  customerId?: string;
  siteId?: string;
  notes?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Partial<Body>;
  const tagIds = Array.isArray(body.tagIds) ? body.tagIds.filter(Boolean) : [];
  const ticketIds = Array.isArray(body.ticketIds) ? body.ticketIds.filter(Boolean) : [];
  const customerId = body.customerId?.trim() || null;
  const siteId = body.siteId?.trim() || null;
  const notes = body.notes?.trim() || null;

  if (tagIds.length === 0) {
    return Response.json({ error: "tagIds required" }, { status: 400 });
  }

  const msg = await prisma.inboxThreadMessage.findUnique({
    where: { id },
    select: {
      id: true,
      ingestionEventId: true,
      threadId: true,
      thread: { select: { id: true, channel: true, conversationKey: true, linkedTicketId: true } },
    },
  });
  if (!msg) return Response.json({ error: "message not found" }, { status: 404 });

  const tags = await prisma.classificationTag.findMany({
    where: { id: { in: tagIds }, active: true },
  });
  if (tags.length === 0) return Response.json({ error: "no active tags resolved" }, { status: 400 });

  const batchId = crypto.randomUUID();
  const targets: Array<{ tagId: string; ticketId: string | null }> = [];
  if (ticketIds.length === 0) {
    for (const t of tags) targets.push({ tagId: t.id, ticketId: null });
  } else {
    for (const t of tags) {
      for (const ticketId of ticketIds) targets.push({ tagId: t.id, ticketId });
    }
  }

  await prisma.manualInboxAction.createMany({
    data: targets.map((t) => ({
      ingestionEventId: msg.ingestionEventId,
      tagId: t.tagId,
      ticketId: t.ticketId,
      batchId,
      notes,
    })),
  });

  const handlerResults: Array<{ tag: string; handler: string | null; result: unknown }> = [];
  for (const tag of tags) {
    const result = await runTagHandler({
      tag,
      ingestionEventId: msg.ingestionEventId,
      threadId: msg.threadId,
      messageId: msg.id,
      ticketIds: ticketIds.length ? ticketIds : (msg.thread.linkedTicketId ? [msg.thread.linkedTicketId] : []),
      customerId,
      siteId,
      batchId,
    });
    handlerResults.push({ tag: tag.name, handler: tag.routingHandler, result });
  }

  return Response.json({
    ok: true,
    batchId,
    actionsCreated: targets.length,
    handlers: handlerResults,
  });
}

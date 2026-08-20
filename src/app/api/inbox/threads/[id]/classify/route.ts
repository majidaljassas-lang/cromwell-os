import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runTagHandler } from "@/lib/inbox/manual-classification";

const CUTOVER = new Date("2026-04-01");

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: threadId } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    tagName?: string;
    ticketIds?: string[];
    customerId?: string | null;
    siteId?: string | null;
  };

  if (!body.tagName) {
    return NextResponse.json({ error: "tagName required" }, { status: 400 });
  }

  const tag = await prisma.classificationTag.findUnique({
    where: { name: body.tagName },
  });
  if (!tag || !tag.active) {
    return NextResponse.json(
      { error: `tag '${body.tagName}' not found or inactive` },
      { status: 404 },
    );
  }

  const thread = await prisma.inboxThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { occurredAt: "desc" }, take: 1 },
    },
  });
  if (!thread) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  const latestMessage = thread.messages[0];
  if (!latestMessage) {
    return NextResponse.json(
      { error: "thread has no messages" },
      { status: 400 },
    );
  }

  const batchId = randomUUID();

  const result = await runTagHandler({
    tag: {
      id: tag.id,
      name: tag.name,
      label: tag.label,
      routingHandler: tag.routingHandler,
    },
    ingestionEventId: latestMessage.ingestionEventId,
    threadId: thread.id,
    messageId: latestMessage.id,
    ticketIds: body.ticketIds ?? [],
    customerId: body.customerId ?? null,
    siteId: body.siteId ?? null,
    batchId,
  });

  await prisma.manualInboxAction.create({
    data: {
      ingestionEventId: latestMessage.ingestionEventId,
      tagId: tag.id,
      ticketId: (body.ticketIds ?? [])[0] ?? null,
      batchId,
      notes: result.message,
    },
  });

  let deleted = false;
  if (result.ok && tag.routingHandler === "noise") {
    // Hard-delete on NOISE — message rows cascade. Audit row above keeps the
    // ingestionEventId so we can still trace what was dismissed.
    await prisma.inboxThread.delete({ where: { id: thread.id } });
    deleted = true;
  } else if (result.ok) {
    // For everything else, ensure the thread leaves the NEW queue.
    const fresh = await prisma.inboxThread.findUnique({
      where: { id: thread.id },
      select: { status: true },
    });
    if (fresh?.status === "NEW") {
      await prisma.inboxThread.update({
        where: { id: thread.id },
        data: { status: "TRIAGED", triagedAt: new Date() },
      });
    }
  }

  // Find the next NEW thread so the card can advance immediately.
  const next = await prisma.inboxThread.findFirst({
    where: {
      status: "NEW",
      latestAt: { gte: CUTOVER },
      id: { not: thread.id },
    },
    orderBy: { latestAt: "desc" },
    select: { id: true },
  });

  return NextResponse.json({
    ok: result.ok,
    handler: result.handler,
    message: result.message,
    deleted,
    nextThreadId: next?.id ?? null,
  });
}

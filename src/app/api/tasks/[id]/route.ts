/**
 * PATCH /api/tasks/:id  — update a Task's status / closure.
 *
 * Body: { status?: "OPEN" | "DONE" | "CANCELLED"; closedBySignal?: string }
 *
 * When a reaction Task transitions to DONE, signal-resolver's thread-advance
 * hook also runs (via task close → InboxThread.reactionTaskId match in
 * resolveTasksForSignal — but this PATCH doesn't go through that path). So
 * we mirror the thread-advance here when the task is a reaction.
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

const VALID_STATUSES = new Set(["OPEN", "DONE", "CANCELLED", "BLOCKED"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    status?: string;
    closedBySignal?: string;
  };

  if (body.status && !VALID_STATUSES.has(body.status)) {
    return Response.json({ error: `invalid status: ${body.status}` }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!task) return Response.json({ error: "task not found" }, { status: 404 });

  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.closedBySignal !== undefined ? { closedBySignal: body.closedBySignal } : {}),
    },
  });

  // Mirror the signal-resolver thread-advance: if a reaction Task closed,
  // archive any InboxThread pointing at it that's still NEW or TRIAGED.
  if (body.status === "DONE") {
    await prisma.inboxThread.updateMany({
      where: { reactionTaskId: id, status: { in: ["NEW", "TRIAGED"] } },
      data: { status: "ARCHIVED", triagedAt: new Date() },
    });
  }

  await logAudit({
    objectType: "Task",
    objectId: id,
    actionType: "TASK_STATUS_CHANGED",
    previousValue: { status: task.status },
    newValue: { status: updated.status, closedBySignal: updated.closedBySignal },
    actor: "USER",
  });

  return Response.json({ ok: true, task: updated });
}

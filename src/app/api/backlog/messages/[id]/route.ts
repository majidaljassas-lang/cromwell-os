import { prisma } from "@/lib/prisma";

/**
 * PATCH: Manually classify a message, set relations, or add notes.
 *
 * Allowed fields:
 * - messageType: ORDER, FOLLOW-UP, DUPLICATE, CONFIRMATION, DELIVERY, OTHER
 * - relationType: NONE, DUPLICATE_OF, FOLLOW_UP_TO, CONFIRMATION_OF
 * - relatedMessageId: ID of the related message
 * - duplicateGroupId: group ID for duplicate cluster
 * - notes: free text
 * - hasAttachment, attachmentRef
 *
 * NO automatic classification. Manual only.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const f of ["messageType", "relationType", "relatedMessageId", "duplicateGroupId", "notes", "hasAttachment", "attachmentRef"]) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }
    if (Object.keys(allowed).length === 0) {
      return Response.json({ error: "No valid fields provided" }, { status: 400 });
    }
    const msg = await prisma.backlogMessage.update({ where: { id }, data: allowed });
    return Response.json(msg);
  } catch (error) {
    return Response.json({ error: "Failed to update message" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.backlogMessage.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: "Failed to delete message" }, { status: 500 });
  }
}

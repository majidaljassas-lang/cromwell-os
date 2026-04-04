import { prisma } from "@/lib/prisma";

/** PATCH: manually classify a message or flag as duplicate/link */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();
    const allowed: Record<string, unknown> = {};
    for (const f of ["messageType", "isDuplicate", "duplicateOfId", "linkedToId", "notes"]) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }
    const msg = await prisma.backlogMessage.update({ where: { id }, data: allowed });
    return Response.json(msg);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

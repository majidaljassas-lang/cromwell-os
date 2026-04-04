import { prisma } from "@/lib/prisma";

/** POST: create a source group + source under a case */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: caseId } = await params;
  try {
    const body = await request.json();
    const { groupName, sourceType, label, participantList, rawFileRef } = body;

    if (!groupName || !sourceType || !label) {
      return Response.json({ error: "groupName, sourceType, label required" }, { status: 400 });
    }

    // Find or create source group
    let group = await prisma.backlogSourceGroup.findFirst({
      where: { caseId, name: groupName, sourceType },
    });
    if (!group) {
      group = await prisma.backlogSourceGroup.create({
        data: { caseId, name: groupName, sourceType, description: body.groupDescription },
      });
    }

    const source = await prisma.backlogSource.create({
      data: {
        groupId: group.id,
        label,
        sourceType,
        participantList: participantList || [],
        rawFileRef,
        status: "CREATED",
      },
    });

    return Response.json({ group, source }, { status: 201 });
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

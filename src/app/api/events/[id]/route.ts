import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { notes, sourceRef, eventType } = body;

    const data: Record<string, unknown> = {};
    if (notes !== undefined) data.notes = notes;
    if (sourceRef !== undefined) data.sourceRef = sourceRef;
    if (eventType !== undefined) data.eventType = eventType;

    const event = await prisma.event.update({
      where: { id },
      data,
    });

    return Response.json(event);
  } catch (error) {
    console.error("Failed to update event:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.event.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete event:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete event" }, { status: 500 });
  }
}

import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const { nextAction } = body;

    const data: Record<string, unknown> = {
      recoveryStatus: "PACK_SENT_FOR_PO" as RecoveryStatus,
      packSentAt: new Date(),
      currentStageStartedAt: new Date(),
    };
    if (nextAction !== undefined) data.nextAction = nextAction;

    const recoveryCase = await prisma.recoveryCase.update({
      where: { id },
      data,
      include: {
        ticket: {
          include: {
            payingCustomer: true,
            site: true,
          },
        },
        evidencePacks: true,
      },
    });

    await prisma.event.create({
      data: {
        ticketId: recoveryCase.ticketId,
        eventType: "PACK_SENT_FOR_PO",
        timestamp: new Date(),
        notes: `Evidence pack sent for PO on recovery case ${id}`,
      },
    });

    return Response.json(recoveryCase);
  } catch (error) {
    console.error("Failed to mark pack sent for PO:", error);
    return Response.json(
      { error: "Failed to mark pack sent for PO" },
      { status: 500 }
    );
  }
}

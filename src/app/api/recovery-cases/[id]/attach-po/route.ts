import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const { poNo, customerPOId } = body;

    const data: Record<string, unknown> = {
      recoveryStatus: "PO_RECEIVED" as RecoveryStatus,
      poReceivedAt: new Date(),
      currentStageStartedAt: new Date(),
    };

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
        eventType: "PO_RECEIVED",
        timestamp: new Date(),
        notes: `PO attached to recovery case ${id}${poNo ? ` (PO: ${poNo})` : ''}`,
      },
    });

    return Response.json(recoveryCase);
  } catch (error) {
    console.error("Failed to attach PO to recovery case:", error);
    return Response.json(
      { error: "Failed to attach PO to recovery case" },
      { status: 500 }
    );
  }
}

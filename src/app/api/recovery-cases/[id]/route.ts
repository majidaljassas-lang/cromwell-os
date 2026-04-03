import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { id },
      include: {
        ticket: {
          include: {
            payingCustomer: true,
            site: true,
            lines: true,
          },
        },
        evidencePacks: {
          include: {
            items: {
              include: {
                evidenceFragment: true,
                event: true,
              },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    if (!recoveryCase) {
      return Response.json(
        { error: "Recovery case not found" },
        { status: 404 }
      );
    }

    return Response.json(recoveryCase);
  } catch (error) {
    console.error("Failed to get recovery case:", error);
    return Response.json(
      { error: "Failed to get recovery case" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { recoveryStatus, nextAction, stuckValue } = body;

    const data: Record<string, unknown> = {};
    if (recoveryStatus !== undefined) {
      data.recoveryStatus = recoveryStatus as RecoveryStatus;
      data.currentStageStartedAt = new Date();
    }
    if (nextAction !== undefined) data.nextAction = nextAction;
    if (stuckValue !== undefined) data.stuckValue = stuckValue;

    const recoveryCase = await prisma.recoveryCase.update({
      where: { id },
      data,
      include: {
        ticket: {
          include: {
            payingCustomer: true,
            site: true,
            lines: true,
          },
        },
        evidencePacks: {
          include: {
            items: {
              include: {
                evidenceFragment: true,
                event: true,
              },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });

    return Response.json(recoveryCase);
  } catch (error) {
    console.error("Failed to update recovery case:", error);
    return Response.json(
      { error: "Failed to update recovery case" },
      { status: 500 }
    );
  }
}

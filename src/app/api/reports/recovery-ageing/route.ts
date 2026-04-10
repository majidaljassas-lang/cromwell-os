import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const recoveryCases = await prisma.recoveryCase.findMany({
      where: { recoveryStatus: { not: "CLOSED" } },
      include: {
        ticket: {
          select: {
            title: true,
            payingCustomer: { select: { name: true } },
          },
        },
      },
      orderBy: { openedAt: "asc" },
    });

    const now = new Date();

    const result = recoveryCases.map((rc) => {
      const daysOpen = rc.openedAt
        ? Math.floor(
            (now.getTime() - new Date(rc.openedAt).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null;
      const daysInCurrentStage = rc.currentStageStartedAt
        ? Math.floor(
            (now.getTime() - new Date(rc.currentStageStartedAt).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null;

      return {
        id: rc.id,
        ticketId: rc.ticketId,
        ticketTitle: rc.ticket.title,
        customerName: rc.ticket.payingCustomer.name,
        recoveryStatus: rc.recoveryStatus,
        stuckValue: rc.stuckValue,
        daysOpen,
        daysInCurrentStage,
        nextAction: rc.nextAction,
        openedAt: rc.openedAt,
        currentStageStartedAt: rc.currentStageStartedAt,
      };
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to compute recovery ageing:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to compute recovery ageing" },
      { status: 500 }
    );
  }
}

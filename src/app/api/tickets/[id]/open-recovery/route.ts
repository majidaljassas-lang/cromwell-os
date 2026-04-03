import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { reasonType, stuckValue } = body;

    if (!reasonType) {
      return Response.json(
        { error: "Missing required field: reasonType" },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.findUnique({ where: { id } });
    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const recoveryCase = await tx.recoveryCase.create({
        data: {
          ticketId: id,
          reasonType,
          recoveryStatus: "OPEN" as RecoveryStatus,
          openedAt: new Date(),
          currentStageStartedAt: new Date(),
          stuckValue: stuckValue ?? 0,
        },
      });

      const evidencePack = await tx.evidencePack.create({
        data: {
          ticketId: id,
          recoveryCaseId: recoveryCase.id,
          packType: "RECOVERY",
          status: "DRAFT",
        },
      });

      await tx.ticket.update({
        where: { id },
        data: { recoveryRequired: true },
      });

      return tx.recoveryCase.findUnique({
        where: { id: recoveryCase.id },
        include: {
          ticket: true,
          evidencePacks: {
            include: {
              items: true,
            },
          },
        },
      });
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to open recovery case:", error);
    return Response.json(
      { error: "Failed to open recovery case" },
      { status: 500 }
    );
  }
}

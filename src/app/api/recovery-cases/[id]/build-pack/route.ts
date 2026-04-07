import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { id },
      include: { ticket: true },
    });

    if (!recoveryCase) {
      return Response.json(
        { error: "Recovery case not found" },
        { status: 404 }
      );
    }

    const ticketId = recoveryCase.ticketId;

    const [evidenceFragments, events] = await Promise.all([
      prisma.evidenceFragment.findMany({
        where: { ticketId },
        orderBy: { timestamp: "asc" },
      }),
      prisma.event.findMany({
        where: { ticketId },
        orderBy: { timestamp: "asc" },
      }),
    ]);

    const result = await prisma.$transaction(async (tx) => {
      // Find or create evidence pack for this recovery case
      let pack = await tx.evidencePack.findFirst({
        where: { recoveryCaseId: id },
      });

      if (!pack) {
        pack = await tx.evidencePack.create({
          data: {
            ticketId,
            recoveryCaseId: id,
            packType: "RECOVERY",
            status: "DRAFT",
            generatedAt: new Date(),
          },
        });
      } else {
        // Clear existing items to rebuild
        await tx.evidencePackItem.deleteMany({
          where: { evidencePackId: pack.id },
        });
        await tx.evidencePack.update({
          where: { id: pack.id },
          data: { generatedAt: new Date() },
        });
      }

      let sortOrder = 0;

      // Add evidence fragments as items
      if (evidenceFragments.length > 0) {
        await tx.evidencePackItem.createMany({
          data: evidenceFragments.map((frag) => ({
            evidencePackId: pack.id,
            evidenceFragmentId: frag.id,
            sortOrder: sortOrder++,
          })),
        });
      }

      // Add key events as items
      if (events.length > 0) {
        await tx.evidencePackItem.createMany({
          data: events.map((evt) => ({
            evidencePackId: pack.id,
            eventId: evt.id,
            sortOrder: sortOrder++,
          })),
        });
      }

      // Update recovery status if currently OPEN or EVIDENCE_BUILDING
      if (
        recoveryCase.recoveryStatus === "OPEN" ||
        recoveryCase.recoveryStatus === "EVIDENCE_BUILDING"
      ) {
        await tx.recoveryCase.update({
          where: { id },
          data: {
            recoveryStatus: "PACK_READY" as RecoveryStatus,
            currentStageStartedAt: new Date(),
          },
        });
      }

      return tx.evidencePack.findUnique({
        where: { id: pack.id },
        include: {
          ticket: true,
          recoveryCase: true,
          items: {
            include: {
              evidenceFragment: true,
              event: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
      });
    });

    await prisma.event.create({
      data: {
        ticketId: recoveryCase.ticketId,
        eventType: "EVIDENCE_PACK_GENERATED",
        timestamp: new Date(),
        notes: `Evidence pack built for recovery case ${id}`,
      },
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to build evidence pack:", error);
    return Response.json(
      { error: "Failed to build evidence pack" },
      { status: 500 }
    );
  }
}

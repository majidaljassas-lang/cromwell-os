import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const recoveryCase = await prisma.recoveryCase.update({
      where: { id },
      data: {
        recoveryStatus: "INVOICE_READY" as RecoveryStatus,
        invoiceUnlockedAt: new Date(),
        currentStageStartedAt: new Date(),
      },
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

    return Response.json(recoveryCase);
  } catch (error) {
    console.error("Failed to unlock invoice for recovery case:", error);
    return Response.json(
      { error: "Failed to unlock invoice for recovery case" },
      { status: 500 }
    );
  }
}

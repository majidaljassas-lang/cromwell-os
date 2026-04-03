import { prisma } from "@/lib/prisma";
import { RecoveryStatus } from "@/generated/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const recoveryStatus = searchParams.get("recoveryStatus");

    const where: Record<string, unknown> = {};
    if (recoveryStatus)
      where.recoveryStatus = recoveryStatus as RecoveryStatus;

    const cases = await prisma.recoveryCase.findMany({
      where,
      include: {
        ticket: {
          include: {
            payingCustomer: true,
            site: true,
          },
        },
        evidencePacks: {
          include: {
            _count: { select: { items: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(cases);
  } catch (error) {
    console.error("Failed to list recovery cases:", error);
    return Response.json(
      { error: "Failed to list recovery cases" },
      { status: 500 }
    );
  }
}

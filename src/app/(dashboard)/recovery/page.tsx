import { prisma } from "@/lib/prisma";
import { RecoveryView } from "@/components/recovery/recovery-view";

export const dynamic = "force-dynamic";

export default async function RecoveryPage() {
  const recoveryCases = await prisma.recoveryCase.findMany({
    include: {
      ticket: {
        include: {
          payingCustomer: true,
          site: true,
        },
      },
      evidencePacks: {
        include: {
          _count: {
            select: { items: true },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Recovery</h1>
      <RecoveryView cases={recoveryCases as any} />
    </div>
  );
}

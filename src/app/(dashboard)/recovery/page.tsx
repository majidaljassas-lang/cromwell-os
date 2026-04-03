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
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">RECOVERY</h1>
      <RecoveryView cases={recoveryCases as any} />
    </div>
  );
}

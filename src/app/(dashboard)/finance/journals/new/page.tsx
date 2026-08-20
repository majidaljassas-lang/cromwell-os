import { prisma } from "@/lib/prisma";
import { JournalForm } from "./JournalForm";

export const dynamic = "force-dynamic";

export default async function NewJournalPage() {
  const accounts = await prisma.chartOfAccount.findMany({
    where: { isActive: true },
    orderBy: { accountCode: "asc" },
    select: { id: true, accountCode: true, accountName: true, accountType: true },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          NEW MANUAL JOURNAL
        </h1>
      </div>
      <JournalForm accounts={accounts} />
    </div>
  );
}

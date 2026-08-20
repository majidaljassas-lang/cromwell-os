import { prisma } from "@/lib/prisma";
import { PaperEntryForm } from "./PaperEntryForm";

export const dynamic = "force-dynamic";

export default async function NewPaperEntryPage() {
  const [customers, suppliers] = await Promise.all([
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          NEW PAPER ENTRY
        </h1>
      </div>
      <PaperEntryForm customers={customers} suppliers={suppliers} />
    </div>
  );
}

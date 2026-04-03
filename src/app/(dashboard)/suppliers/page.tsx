import { prisma } from "@/lib/prisma";
import { SuppliersTable } from "@/components/suppliers/suppliers-table";

export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-4 space-y-4">
      <SuppliersTable suppliers={suppliers as any} />
    </div>
  );
}

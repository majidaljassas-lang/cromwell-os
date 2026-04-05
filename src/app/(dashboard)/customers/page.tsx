import { prisma } from "@/lib/prisma";
import { CustomersTable } from "@/components/customers/customers-table";

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    include: {
      siteCommercialLinks: true,
      subsidiaries: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <CustomersTable customers={s(customers)} />
    </div>
  );
}

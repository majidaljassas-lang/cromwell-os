import { prisma } from "@/lib/prisma";
import { CustomersTable } from "@/components/customers/customers-table";

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const customers = await prisma.customer.findMany({
    include: {
      siteCommercialLinks: true,
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-4 space-y-4">
      <CustomersTable customers={customers} />
    </div>
  );
}

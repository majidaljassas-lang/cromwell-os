import { prisma } from "@/lib/prisma";
import { EnquiriesTable } from "@/components/enquiries/enquiries-table";

export const dynamic = 'force-dynamic';

export default async function EnquiriesPage() {
  const [enquiries, customers] = await Promise.all([
    prisma.enquiry.findMany({
      include: {
        sourceContact: true,
        suggestedSite: true,
        suggestedCustomer: true,
        workItems: true,
      },
      orderBy: { receivedAt: "desc" },
    }),
    prisma.customer.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="p-4 space-y-4">
      <EnquiriesTable
        enquiries={JSON.parse(JSON.stringify(enquiries))}
        customers={JSON.parse(JSON.stringify(customers))}
      />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { EnquiriesTable } from "@/components/enquiries/enquiries-table";

export const dynamic = 'force-dynamic';

export default async function EnquiriesPage() {
  const enquiries = await prisma.enquiry.findMany({
    include: {
      sourceContact: true,
      suggestedSite: true,
      suggestedCustomer: true,
      workItems: true,
    },
    orderBy: { receivedAt: "desc" },
  });
  const customers = await prisma.customer.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <EnquiriesTable
        enquiries={s(enquiries)}
        customers={s(customers)}
      />
    </div>
  );
}

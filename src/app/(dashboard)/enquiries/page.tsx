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

  return (
    <div className="p-4 space-y-4">
      <EnquiriesTable enquiries={enquiries} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { ContactsTable } from "@/components/contacts/contacts-table";

export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const contacts = await prisma.contact.findMany({
    orderBy: { fullName: "asc" },
  });

  return (
    <div className="p-4 space-y-4">
      <ContactsTable contacts={contacts} />
    </div>
  );
}

import { prisma } from "@/lib/prisma";
import { AutoIntakeCleanupTable } from "@/components/customers/auto-intake-cleanup-table";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AutoIntakeCleanupPage() {
  const rows = await prisma.customer.findMany({
    where: { name: { contains: "(auto-intake)" } },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: {
        select: {
          ticketsAsPayer: true,
          ticketLinesAsPayer: true,
          invoices: true,
          siteContactLinks: true,
          siteCommercialLinks: true,
        },
      },
      ticketsAsPayer: {
        select: { id: true, ticketNo: true, title: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
      siteContactLinks: {
        select: {
          contact: { select: { id: true, fullName: true, email: true, phone: true } },
          site: { select: { id: true, siteName: true } },
        },
        take: 5,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const data = rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    counts: {
      tickets: r._count.ticketsAsPayer,
      ticketLines: r._count.ticketLinesAsPayer,
      invoices: r._count.invoices,
      contactLinks: r._count.siteContactLinks,
      commercialLinks: r._count.siteCommercialLinks,
    },
    recentTickets: r.ticketsAsPayer.map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      title: t.title,
      createdAt: t.createdAt.toISOString(),
    })),
    contacts: r.siteContactLinks.map((l) => ({
      contactId: l.contact.id,
      contactName: l.contact.fullName,
      email: l.contact.email,
      phone: l.contact.phone,
      siteId: l.site.id,
      siteName: l.site.siteName,
    })),
  }));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/customers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back
          </Button>
        </Link>
        <h1 className="text-lg font-medium">Auto-intake cleanup</h1>
        <span className="text-xs text-muted-foreground">
          {data.length} customer{data.length === 1 ? "" : "s"} need reassignment
        </span>
      </div>
      <p className="text-xs text-muted-foreground max-w-3xl">
        These were created by the old auto-intake fallback when a sender could not be matched
        to an existing customer. They are typically buyers/contacts at real customer
        organisations, not customers themselves. Reassign each one to the correct customer —
        all tickets, lines, invoices, links, and history will be moved, and the auto-intake
        record deleted.
      </p>
      <AutoIntakeCleanupTable rows={data} />
    </div>
  );
}

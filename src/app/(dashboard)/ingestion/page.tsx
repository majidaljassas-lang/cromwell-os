import { prisma } from "@/lib/prisma";
import { IngestionView } from "@/components/ingestion/ingestion-view";

export const dynamic = 'force-dynamic';

export default async function IngestionPage() {
  const [
    inboxEvents,
    siteMatches,
    draftInvoices,
    reconstructionBatches,
    sources,
    sites,
    customers,
    suppliers,
    tickets,
  ] = await Promise.all([
    prisma.ingestionEvent.findMany({
      where: { status: { in: ["PARSED", "NORMALISED", "CLASSIFIED", "MATCHED"] } },
      include: {
        source: { select: { sourceType: true, accountName: true } },
        parsedMessages: {
          orderBy: { parseVersion: "desc" },
          take: 1,
          select: {
            id: true, extractedText: true, messageType: true,
            confidenceScore: true, structuredData: true,
            ingestionLinks: { select: { id: true, linkStatus: true } },
          },
        },
        sourceSiteMatches: {
          select: { id: true, rawSiteText: true, reviewStatus: true, confidenceScore: true,
            matchedSite: { select: { id: true, siteName: true } } },
        },
      },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    prisma.sourceSiteMatch.findMany({
      where: { reviewStatus: "UNRESOLVED" },
      include: {
        matchedSite: { select: { id: true, siteName: true } },
        ingestionEvent: { select: { id: true, source: { select: { sourceType: true } }, receivedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.draftInvoiceRecoveryItem.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.reconstructionBatch.findMany({ orderBy: { monthYear: "desc" } }),
    prisma.ingestionSource.findMany(),
    prisma.site.findMany({ select: { id: true, siteName: true }, orderBy: { siteName: "asc" } }),
    prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        INGESTION
      </h1>
      <IngestionView
        inboxEvents={JSON.parse(JSON.stringify(inboxEvents))}
        siteMatches={JSON.parse(JSON.stringify(siteMatches))}
        draftInvoices={JSON.parse(JSON.stringify(draftInvoices))}
        reconstructionBatches={JSON.parse(JSON.stringify(reconstructionBatches))}
        sources={JSON.parse(JSON.stringify(sources))}
        sites={JSON.parse(JSON.stringify(sites))}
        customers={JSON.parse(JSON.stringify(customers))}
        suppliers={JSON.parse(JSON.stringify(suppliers))}
        tickets={JSON.parse(JSON.stringify(tickets))}
      />
    </div>
  );
}

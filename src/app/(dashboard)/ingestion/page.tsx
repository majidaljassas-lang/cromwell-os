import { prisma } from "@/lib/prisma";
import { IngestionView } from "@/components/ingestion/ingestion-view";

export const dynamic = 'force-dynamic';

export default async function IngestionPage() {
  // Sequential queries to avoid connection exhaustion on Prisma dev server
  const inboxEvents = await prisma.ingestionEvent.findMany({
    where: { status: { in: ["PARSED", "NORMALISED", "CLASSIFIED", "MATCHED", "NEEDS_TRIAGE"] } },
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
  });
  const siteMatches = await prisma.sourceSiteMatch.findMany({
    where: { reviewStatus: "UNRESOLVED" },
    include: {
      matchedSite: { select: { id: true, siteName: true } },
      ingestionEvent: { select: { id: true, source: { select: { sourceType: true } }, receivedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const draftInvoices = await prisma.draftInvoiceRecoveryItem.findMany({ orderBy: { createdAt: "desc" } });
  const reconstructionBatches = await prisma.reconstructionBatch.findMany({ orderBy: { monthYear: "desc" } });
  const sources = await prisma.ingestionSource.findMany();
  const sites = await prisma.site.findMany({ select: { id: true, siteName: true }, orderBy: { siteName: "asc" } });
  const customers = await prisma.customer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const tickets = await prisma.ticket.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        INGESTION
      </h1>
      <IngestionView
        inboxEvents={s(inboxEvents)}
        siteMatches={s(siteMatches)}
        draftInvoices={s(draftInvoices)}
        reconstructionBatches={s(reconstructionBatches)}
        sources={s(sources)}
        sites={s(sites)}
        customers={s(customers)}
        suppliers={s(suppliers)}
        tickets={s(tickets)}
      />
    </div>
  );
}

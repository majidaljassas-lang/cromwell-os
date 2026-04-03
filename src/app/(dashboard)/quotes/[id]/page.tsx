import { prisma } from "@/lib/prisma";
import { QuoteBuilder } from "@/components/quotes/quote-builder";

export const dynamic = "force-dynamic";

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      lines: { include: { ticketLine: true } },
      customer: true,
      ticket: {
        include: {
          site: true,
          payingCustomer: true,
          lines: {
            select: {
              id: true,
              expectedCostUnit: true,
              expectedCostTotal: true,
              actualMarginTotal: true,
            },
          },
        },
      },
      site: true,
    },
  });

  if (!quote) {
    return (
      <div className="p-4">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF3333] uppercase bb-mono">
          QUOTE NOT FOUND
        </h1>
      </div>
    );
  }

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <QuoteBuilder quote={s(quote)} />
    </div>
  );
}

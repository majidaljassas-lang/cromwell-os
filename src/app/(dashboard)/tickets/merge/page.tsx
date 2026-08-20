import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { TicketMergeForm } from "@/components/tickets/ticket-merge-form";

export const dynamic = "force-dynamic";

function parseIds(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = new Set<string>();
  for (const v of list) {
    for (const part of v.split(",").map((s) => s.trim()).filter(Boolean)) {
      out.add(part);
    }
  }
  return Array.from(out);
}

export default async function TicketsMergePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ids = parseIds(params.ids);
  if (ids.length < 2) notFound();

  const tickets = await prisma.ticket.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      payingCustomer: { select: { id: true, name: true } },
      site: { select: { id: true, siteName: true } },
      _count: { select: { lines: true } },
      quotes: {
        select: { id: true, totalSell: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (tickets.length !== ids.length) notFound();

  const customers = new Set(tickets.map((t) => t.payingCustomer.id));
  const sites = new Set(tickets.map((t) => t.site?.id ?? null));
  const customerMismatch = customers.size > 1;
  const siteMismatch = sites.size > 1;

  const currentTotal = tickets.reduce(
    (acc, t) => acc + Number(t.quotes[0]?.totalSell ?? 0),
    0
  );

  const customerName = tickets[0].payingCustomer.name;
  const siteName = tickets[0].site?.siteName ?? "(no site)";

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2">
        <Link href="/tickets">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back
          </Button>
        </Link>
        <h1 className="text-lg font-medium">Combine tickets into one</h1>
      </div>

      {(customerMismatch || siteMismatch) && (
        <div className="rounded border border-[#FF3333]/40 bg-[#FF3333]/10 p-3 text-xs">
          {customerMismatch && <div>Source tickets have different customers — cannot merge.</div>}
          {siteMismatch && <div>Source tickets have different sites — cannot merge.</div>}
        </div>
      )}

      <div className="rounded border p-3 space-y-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Source tickets
        </div>
        {tickets.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-xs">
            <div>
              <Link
                href={`/tickets/${t.id}`}
                className="text-[#FF6600] underline-offset-2 hover:underline"
              >
                CP-{String(t.ticketNo).padStart(4, "0")}
              </Link>{" "}
              {t.title}
            </div>
            <div className="text-muted-foreground">
              {t._count.lines} lines · {t.status} ·{" "}
              {t.quotes[0]
                ? `£${Number(t.quotes[0].totalSell).toLocaleString("en-GB", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "no quote"}
            </div>
          </div>
        ))}
        <div className="border-t pt-2 flex justify-between text-xs">
          <span className="text-muted-foreground">
            {customerName} @ {siteName}
          </span>
          <span>
            Current total ex VAT:{" "}
            <span className="text-[#E0E0E0]">
              £
              {currentTotal.toLocaleString("en-GB", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
        </div>
      </div>

      {!customerMismatch && !siteMismatch && (
        <TicketMergeForm
          ticketIds={tickets.map((t) => t.id)}
          defaultTitle={`${siteName} — combined supply`}
          defaultFinalTotal={null}
          currentTotal={currentTotal}
        />
      )}
    </div>
  );
}
